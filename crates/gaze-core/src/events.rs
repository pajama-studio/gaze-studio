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
