use crate::{
    analysis::quantile,
    geometry::map_time,
    types::{Anchor, Settings},
};
use serde::{Deserialize, Serialize};
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EyeSignal {
    pub t: f64,
    pub eye: String,
    pub confidence: f64,
    pub pupil: Option<f64>,
    pub pupil_unit: String,
}
#[derive(Deserialize)]
pub struct Input {
    pub signals: Vec<EyeSignal>,
    pub anchors: Vec<Anchor>,
    pub settings: Settings,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub eye: String,
    pub unit: String,
    pub samples: usize,
    pub valid_samples: usize,
    pub valid_time: f64,
    pub coverage: f64,
    pub mean: Option<f64>,
    pub median: Option<f64>,
    pub sd: Option<f64>,
    pub p05: Option<f64>,
    pub p95: Option<f64>,
}
pub fn describe(input: Input) -> Result<Vec<Summary>, String> {
    if input.anchors.is_empty() {
        return Err("Eye signals need clock anchors".into());
    }
    let mut out = Vec::new();
    for eye in ["left", "right"] {
        let mut rows: Vec<_> = input
            .signals
            .iter()
            .filter(|s| s.eye == eye)
            .map(|s| (map_time(s.t, &input.anchors), s))
            .collect();
        rows.sort_by(|a, b| a.0.total_cmp(&b.0));
        let selected: Vec<_> = rows
            .iter()
            .filter(|(t, _)| *t >= input.settings.start && *t < input.settings.end)
            .collect();
        if selected.is_empty() {
            continue;
        }
        let unit = selected[0].1.pupil_unit.clone();
        if selected.iter().any(|(_, s)| s.pupil_unit != unit) {
            return Err("Mixed pupil units within an eye stream".into());
        }
        let valid =
            |s: &EyeSignal| s.confidence >= 0.6 && s.pupil.is_some_and(|p| p.is_finite() && p > 0.);
        let values: Vec<f64> = selected
            .iter()
            .filter(|(_, s)| valid(s))
            .map(|(_, s)| s.pupil.unwrap())
            .collect();
        let mut valid_time = 0.;
        for pair in rows.windows(2) {
            let (t, s) = pair[0];
            let next = pair[1].0;
            if valid(s) && next > t && next - t <= input.settings.max_gap {
                valid_time += (next.min(input.settings.end) - t.max(input.settings.start)).max(0.);
            }
        }
        let mean = if values.is_empty() {
            None
        } else {
            Some(values.iter().sum::<f64>() / values.len() as f64)
        };
        let sd = mean.map(|m| {
            (values.iter().map(|v| (v - m).powi(2)).sum::<f64>() / values.len() as f64).sqrt()
        });
        let q = |p| {
            if values.is_empty() {
                None
            } else {
                Some(quantile(&mut values.clone(), p))
            }
        };
        out.push(Summary {
            eye: eye.into(),
            unit,
            samples: selected.len(),
            valid_samples: values.len(),
            valid_time,
            coverage: valid_time / (input.settings.end - input.settings.start).max(1.),
            mean,
            median: q(0.5),
            sd,
            p05: q(0.05),
            p95: q(0.95),
        });
    }
    Ok(out)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_mixed_units_and_keeps_low_confidence_out_of_pupil_statistics() {
        let input = r#"{"signals":[{"t":0,"eye":"left","confidence":1,"pupil":2,"pupilUnit":"mm"},{"t":10000,"eye":"left","confidence":1,"pupil":4,"pupilUnit":"mm"},{"t":20000,"eye":"left","confidence":0.2,"pupil":100,"pupilUnit":"mm"}],"anchors":[{"gaze":0,"media":0}],"settings":{"method":"ivt","velocity":800,"dispersion":65,"minFixation":100000,"maxGap":75000,"participant":"all","start":0,"end":30000}}"#;
        let out = describe(serde_json::from_str(input).unwrap()).unwrap();
        assert_eq!(out[0].mean, Some(3.));
        assert_eq!(out[0].valid_samples, 2);
        assert_eq!(out[0].valid_time, 20000.);
        assert!(
            describe(serde_json::from_str(&input.replacen("\"mm\"", "\"px\"", 1)).unwrap())
                .is_err()
        );
    }
}
