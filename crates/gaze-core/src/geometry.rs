use crate::types::{Anchor, Aoi};
pub fn map_time(t: f64, a: &[Anchor]) -> f64 {
    if a.len() == 1 {
        return t - a[0].gaze + a[0].media;
    }
    let i = a
        .partition_point(|v| v.gaze < t)
        .saturating_sub(1)
        .min(a.len() - 2);
    a[i].media + (t - a[i].gaze) * (a[i + 1].media - a[i].media) / (a[i + 1].gaze - a[i].gaze)
}
pub fn points_at(a: &Aoi, t: f64) -> Option<Vec<[f64; 2]>> {
    if t < a.start || t >= a.end || a.keyframes.is_empty() {
        return None;
    }
    let i = a.keyframes.partition_point(|k| k.t <= t).saturating_sub(1);
    let k = &a.keyframes[i];
    if let Some(b) = a.keyframes.get(i + 1) {
        if t > k.t && k.points.len() == b.points.len() {
            let p = (t - k.t) / (b.t - k.t);
            return Some(
                k.points
                    .iter()
                    .zip(&b.points)
                    .map(|(a, b)| [a[0] + (b[0] - a[0]) * p, a[1] + (b[1] - a[1]) * p])
                    .collect(),
            );
        }
    }
    Some(k.points.clone())
}
pub fn contains(a: &Aoi, x: f64, y: f64, t: f64) -> bool {
    let Some(p) = points_at(a, t) else {
        return false;
    };
    if a.shape != "polygon" {
        if p.len() < 2 {
            return false;
        }
        let left = p[0][0].min(p[1][0]);
        let top = p[0][1].min(p[1][1]);
        let w = (p[1][0] - p[0][0]).abs();
        let h = (p[1][1] - p[0][1]).abs();
        if w == 0. || h == 0. {
            return false;
        }
        return if a.shape == "rectangle" {
            x >= left && x <= left + w && y >= top && y <= top + h
        } else {
            ((x - left - w / 2.) / (w / 2.)).powi(2) + ((y - top - h / 2.) / (h / 2.)).powi(2) <= 1.
        };
    }
    let mut inside = false;
    if p.len() < 3 {
        return false;
    }
    let mut j = p.len() - 1;
    for i in 0..p.len() {
        if (p[i][1] > y) != (p[j][1] > y)
            && x < (p[j][0] - p[i][0]) * (y - p[i][1]) / (p[j][1] - p[i][1]) + p[i][0]
        {
            inside = !inside
        }
        j = i;
    }
    inside
}
