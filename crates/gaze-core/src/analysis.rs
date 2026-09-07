use crate::{
    events,
    geometry::{contains, map_time},
    types::*,
};
pub fn quantile(a: &mut [f64], q: f64) -> f64 {
    if a.is_empty() {
        return 0.;
    }
    a.sort_by(f64::total_cmp);
    let p = (a.len() - 1) as f64 * q;
    let i = p.floor() as usize;
    a[i] + (a[(i + 1).min(a.len() - 1)] - a[i]) * (p - i as f64)
}
pub fn analyze(r: Recording, mut s: Settings) -> Result<Partial, String> {
    if r.anchors.is_empty()
        || !r.duration.is_finite()
        || r.duration <= 0.
        || !["ivt", "idt"].contains(&s.method.as_str())
        || [s.velocity, s.dispersion, s.min_fixation, s.max_gap]
            .iter()
            .any(|x| !x.is_finite() || *x <= 0.)
    {
        return Err("Invalid analysis geometry, clock or settings".into());
    }
    if r.anchors
        .windows(2)
        .any(|a| a[1].gaze <= a[0].gaze || a[1].media <= a[0].media)
    {
        return Err("Clock anchors must strictly increase".into());
    }
    s.start = s.start.max(0.);
    s.end = s.end.min(r.duration);
    let mut groups: Vec<(String, Vec<Gaze>)> = Vec::new();
    let mut group_index = std::collections::HashMap::new();
    for mut g in r.samples {
        if s.participant != "all" && g.participant != s.participant {
            continue;
        }
        g.t = map_time(g.t, &r.anchors);
        let i = *group_index.entry(g.participant.clone()).or_insert_with(|| {
            groups.push((g.participant.clone(), Vec::new()));
            groups.len() - 1
        });
        groups[i].1.push(g);
    }
    let aois: Vec<Aoi> = r
        .aois
        .into_iter()
        .filter(|a| a.accepted && (s.aoi_scope.as_deref() != Some("automatic") || a.automatic()))
        .collect();
    let mut out = Analysis {
        samples: 0,
        valid_samples: 0,
        duration: (s.end - s.start).max(0.) * groups.len() as f64,
        valid_time: 0.,
        coverage: 0.,
        median_hz: 0.,
        gaps: 0,
        fixations: Vec::new(),
        aoi: aois
            .iter()
            .map(|a| Metric {
                id: a.id.clone(),
                name: a.name.clone(),
                dwell: 0.,
                visits: 0,
                ttff: None,
                fixation_count: 0,
                fixation_duration: 0.,
            })
            .collect(),
        transitions: Vec::new(),
        sequences: Vec::new(),
        pupil: Pupil {
            mean: None,
            count: 0,
        },
        blink_samples: 0,
        velocities: Vec::new(),
        parameters: s.clone(),
        version: "gaze-studio-rust/0.2.0".into(),
    };
    let mut intervals = Vec::new();
    let mut pupil_sum = 0.;
    for (participant, mut data) in groups {
        data.sort_by(|a, b| a.t.total_cmp(&b.t));
        let range: Vec<Gaze> = data
            .iter()
            .filter(|g| g.t >= s.start && g.t <= s.end)
            .cloned()
            .collect();
        let fixes = events::detect(&range, &s);
        out.samples += range.len();
        out.valid_samples += range.iter().filter(|g| g.usable()).count();
        out.blink_samples += range.iter().filter(|g| g.blink).count();
        for g in &range {
            if g.usable() {
                if let Some(p) = g.pupil {
                    if p.is_finite() && p > 0. {
                        pupil_sum += p;
                        out.pupil.count += 1;
                    }
                }
            }
        }
        let mut previous_hits = vec![false; aois.len()];
        let mut previous_primary: Option<String> = None;
        for pair in data.windows(2) {
            let a = &pair[0];
            let b = &pair[1];
            if b.t <= s.start || a.t >= s.end {
                continue;
            }
            let dt = b.t - a.t;
            let lo = a.t.max(s.start);
            let hi = b.t.min(s.end);
            if dt > 0. {
                intervals.push(dt)
            }
            if dt > s.max_gap {
                out.gaps += 1
            }
            let valid = dt > 0. && dt <= s.max_gap && a.usable() && b.usable();
            if valid {
                out.valid_time += hi - lo;
                out.velocities.push(Velocity {
                    t: a.t,
                    v: (b.x.unwrap() - a.x.unwrap()).hypot(b.y.unwrap() - a.y.unwrap())
                        / (dt / 1e6),
                });
            }
            let mut boundaries = vec![lo, hi];
            for o in &aois {
                for t in [o.start, o.end] {
                    if t > lo && t < hi {
                        boundaries.push(t)
                    }
                }
            }
            boundaries.sort_by(f64::total_cmp);
            boundaries.dedup();
            for span in boundaries.windows(2) {
                let hits: Vec<bool> = aois
                    .iter()
                    .map(|o| valid && contains(o, a.x.unwrap(), a.y.unwrap(), span[0]))
                    .collect();
                for (i, hit) in hits.iter().enumerate() {
                    if *hit {
                        out.aoi[i].dwell += span[1] - span[0];
                        if !previous_hits[i] {
                            out.aoi[i].visits += 1
                        }
                    }
                }
                let primary = hits.iter().position(|v| *v).map(|i| aois[i].id.clone());
                if let (Some(from), Some(to)) = (&previous_primary, &primary) {
                    if from != to {
                        if let Some(old) = out
                            .transitions
                            .iter_mut()
                            .find(|v| &v.from == from && &v.to == to)
                        {
                            old.count += 1
                        } else {
                            out.transitions.push(Transition {
                                from: from.clone(),
                                to: to.clone(),
                                count: 1,
                            });
                        }
                    }
                }
                if let Some(last) = out.sequences.last_mut().filter(|v| {
                    v.participant == participant && v.aoi == primary && v.end == span[0]
                }) {
                    last.end = span[1]
                } else {
                    out.sequences.push(Sequence {
                        start: span[0],
                        end: span[1],
                        aoi: primary.clone(),
                        participant: participant.clone(),
                    })
                }
                previous_hits = hits;
                previous_primary = primary;
            }
        }
        for f in &fixes {
            for (i, a) in aois.iter().enumerate() {
                if contains(a, f.x, f.y, f.start) {
                    let m = &mut out.aoi[i];
                    m.fixation_count += 1;
                    m.fixation_duration += f.end - f.start;
                    let ttff = (f.start - s.start.max(a.start)).max(0.);
                    m.ttff = Some(m.ttff.unwrap_or(f64::INFINITY).min(ttff));
                }
            }
        }
        out.fixations.extend(fixes);
    }
    out.coverage = if out.duration > 0. {
        out.valid_time / out.duration
    } else {
        0.
    };
    out.median_hz = if intervals.is_empty() {
        0.
    } else {
        1e6 / quantile(&mut intervals.clone(), 0.5)
    };
    out.pupil.mean = if out.pupil.count > 0 {
        Some(pupil_sum / out.pupil.count as f64)
    } else {
        None
    };
    Ok(Partial {
        result: out,
        intervals,
        pupil_sum,
    })
}
pub fn merge(mut parts: Vec<Partial>) -> Result<Analysis, String> {
    if parts.is_empty() {
        return Err("No analysis partitions".into());
    }
    let mut first = parts.remove(0);
    for p in parts {
        let a = &mut first.result;
        let b = p.result;
        if a.aoi.iter().map(|m| &m.id).ne(b.aoi.iter().map(|m| &m.id)) {
            return Err("Incompatible AOI partitions".into());
        }
        a.samples += b.samples;
        a.valid_samples += b.valid_samples;
        a.duration += b.duration;
        a.valid_time += b.valid_time;
        a.gaps += b.gaps;
        a.blink_samples += b.blink_samples;
        a.fixations.extend(b.fixations);
        a.sequences.extend(b.sequences);
        a.velocities.extend(b.velocities);
        a.pupil.count += b.pupil.count;
        for (m, n) in a.aoi.iter_mut().zip(b.aoi) {
            m.dwell += n.dwell;
            m.visits += n.visits;
            m.fixation_count += n.fixation_count;
            m.fixation_duration += n.fixation_duration;
            if let Some(t) = n.ttff {
                m.ttff = Some(m.ttff.unwrap_or(f64::INFINITY).min(t));
            }
        }
        for t in b.transitions {
            if let Some(old) = a
                .transitions
                .iter_mut()
                .find(|v| v.from == t.from && v.to == t.to)
            {
                old.count += t.count
            } else {
                a.transitions.push(t)
            }
        }
        first.intervals.extend(p.intervals);
        first.pupil_sum += p.pupil_sum;
    }
    let a = &mut first.result;
    a.coverage = if a.duration > 0. {
        a.valid_time / a.duration
    } else {
        0.
    };
    a.median_hz = if first.intervals.is_empty() {
        0.
    } else {
        1e6 / quantile(&mut first.intervals, 0.5)
    };
    a.pupil.mean = if a.pupil.count > 0 {
        Some(first.pupil_sum / a.pupil.count as f64)
    } else {
        None
    };
    Ok(first.result)
}
