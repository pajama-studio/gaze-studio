use crate::types::{Fixation, Gaze, Settings};
fn emit(a: &[Gaze], s: &Settings, out: &mut Vec<Fixation>) {
    if a.len() < 2 || a.last().unwrap().t - a[0].t < s.min_fixation {
        return;
    }
    out.push(Fixation {
        start: a[0].t,
        end: a.last().unwrap().t,
        x: a.iter().map(|g| g.x.unwrap()).sum::<f64>() / a.len() as f64,
        y: a.iter().map(|g| g.y.unwrap()).sum::<f64>() / a.len() as f64,
        participant: a[0].participant.clone(),
    });
}
pub fn detect(samples: &[Gaze], s: &Settings) -> Vec<Fixation> {
    let mut segments: Vec<Vec<Gaze>> = Vec::new();
    let mut current: Vec<Gaze> = Vec::new();
    for sample in samples {
        if !sample.usable()
            || current
                .last()
                .is_some_and(|last| sample.t - last.t > s.max_gap)
        {
            if !current.is_empty() {
                segments.push(std::mem::take(&mut current));
            }
        }
        if sample.usable() {
            current.push(sample.clone());
        }
    }
    if !current.is_empty() {
        segments.push(current);
    }
    let mut output = Vec::new();
    for a in segments {
        if s.method == "ivt" {
            let mut start = 0;
            for i in 1..a.len() {
                let dt = a[i].t - a[i - 1].t;
                let v = if dt > 0. {
                    (a[i].x.unwrap() - a[i - 1].x.unwrap())
                        .hypot(a[i].y.unwrap() - a[i - 1].y.unwrap())
                        / (dt / 1e6)
                } else {
                    f64::INFINITY
                };
                if v > s.velocity {
                    emit(&a[start..i], s, &mut output);
                    start = i;
                }
            }
            emit(&a[start..], s, &mut output);
        } else {
            let mut start = 0;
            while start + 1 < a.len() {
                let mut end = start;
                let (mut min_x, mut max_x, mut min_y, mut max_y) = (
                    f64::INFINITY,
                    f64::NEG_INFINITY,
                    f64::INFINITY,
                    f64::NEG_INFINITY,
                );
                while end < a.len() {
                    let (nx, xx, ny, xy) = (
                        min_x.min(a[end].x.unwrap()),
                        max_x.max(a[end].x.unwrap()),
                        min_y.min(a[end].y.unwrap()),
                        max_y.max(a[end].y.unwrap()),
                    );
                    if xx - nx + xy - ny > s.dispersion {
                        break;
                    }
                    (min_x, max_x, min_y, max_y) = (nx, xx, ny, xy);
                    end += 1;
                }
                if end > start && a[end - 1].t - a[start].t >= s.min_fixation {
                    emit(&a[start..end], s, &mut output);
                    start = end;
                } else {
                    start += 1;
                }
            }
        }
    }
    output
}

/// Contiguous above-threshold gaze-velocity intervals. These are saccade
/// candidates in stimulus pixels, not a validated angular event classifier.
/// Invalid endpoints, blinks, duplicate timestamps and capture gaps split events.
pub fn saccades(samples: &[Gaze], s: &Settings) -> Vec<crate::types::Saccade> {
    use crate::types::Saccade;
    let mut intervals: Vec<f64> = samples
        .windows(2)
        .map(|p| p[1].t - p[0].t)
        .filter(|dt| *dt > 0. && *dt <= s.max_gap)
        .collect();
    intervals.sort_by(f64::total_cmp);
    // Nearly coincident exports cannot support a stable finite-difference speed.
    // Reject pairs below a quarter of this participant's median sample interval.
    let minimum_interval = if intervals.is_empty() {
        0.
    } else {
        (intervals[(intervals.len() - 1) / 2] + intervals[intervals.len() / 2]) / 8.
    };
    let mut out: Vec<Saccade> = Vec::new();
    let mut current: Option<Saccade> = None;
    for pair in samples.windows(2) {
        let (a, b) = (&pair[0], &pair[1]);
        let dt = b.t - a.t;
        let valid = a.usable()
            && b.usable()
            && a.participant == b.participant
            && dt > 0.
            && dt >= minimum_interval
            && dt <= s.max_gap;
        let v = if valid {
            (b.x.unwrap() - a.x.unwrap()).hypot(b.y.unwrap() - a.y.unwrap()) / (dt / 1e6)
        } else {
            0.
        };
        if valid && v > s.velocity {
            if let Some(event) = current
                .as_mut()
                .filter(|e| e.end == a.t && e.participant == a.participant)
            {
                event.end = b.t;
                event.end_x = b.x.unwrap();
                event.end_y = b.y.unwrap();
                event.peak_velocity = event.peak_velocity.max(v);
                event.amplitude = (event.end_x - event.start_x).hypot(event.end_y - event.start_y);
            } else {
                if let Some(event) = current.take() {
                    out.push(event);
                }
                current = Some(Saccade {
                    start: a.t,
                    end: b.t,
                    start_x: a.x.unwrap(),
                    start_y: a.y.unwrap(),
                    end_x: b.x.unwrap(),
                    end_y: b.y.unwrap(),
                    amplitude: (b.x.unwrap() - a.x.unwrap()).hypot(b.y.unwrap() - a.y.unwrap()),
                    peak_velocity: v,
                    participant: a.participant.clone(),
                });
            }
        } else if let Some(event) = current.take() {
            out.push(event);
        }
    }
    if let Some(event) = current {
        out.push(event);
    }
    out.retain(|event| event.end - event.start >= 10000.);
    out
}

#[cfg(test)]
mod candidate_tests {
    use super::*;
    fn sample(t: f64, x: f64, valid: bool) -> Gaze {
        Gaze {
            t,
            x: Some(x),
            y: Some(0.),
            valid,
            participant: "A".into(),
            pupil: None,
            blink: false,
        }
    }
    #[test]
    fn candidates_measure_velocity_and_split_at_invalid_samples_and_gaps() {
        let s:Settings=serde_json::from_str(r#"{"method":"ivt","velocity":800,"dispersion":65,"minFixation":100000,"maxGap":75000,"participant":"all","start":0,"end":1000000}"#).unwrap();
        let data = vec![
            sample(0., 0., true),
            sample(10000., 20., true),
            sample(20000., 50., true),
            sample(30000., 50., false),
            sample(40000., 100., true),
            sample(50000., 120., true),
            sample(200000., 300., true),
            sample(210000., 310., true),
        ];
        let out = saccades(&data, &s);
        assert_eq!(out.len(), 3);
        assert_eq!(out[0].start, 0.);
        assert_eq!(out[0].end, 20000.);
        assert_eq!(out[0].amplitude, 50.);
        assert_eq!(out[0].peak_velocity, 3000.);
        assert_eq!(out[1].start, 40000.);
        assert_eq!(out[2].start, 200000.);
    }
    #[test]
    fn nearly_coincident_timestamps_do_not_create_extreme_speed_candidates() {
        let s:Settings=serde_json::from_str(r#"{"method":"ivt","velocity":800,"dispersion":65,"minFixation":100000,"maxGap":75000,"participant":"all","start":0,"end":1000000}"#).unwrap();
        let data = vec![
            sample(0., 0., true),
            sample(10000., 0., true),
            sample(10003., 300., true),
            sample(20000., 300., true),
            sample(30000., 300., true),
        ];
        assert!(saccades(&data, &s).is_empty());
    }
}
