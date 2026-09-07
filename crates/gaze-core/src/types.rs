use serde::{Deserialize, Serialize};
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Gaze {
    pub t: f64,
    pub x: Option<f64>,
    pub y: Option<f64>,
    pub valid: bool,
    pub participant: String,
    pub pupil: Option<f64>,
    #[serde(default)]
    pub blink: bool,
}
impl Gaze {
    pub fn usable(&self) -> bool {
        self.valid
            && !self.blink
            && self.x.is_some_and(f64::is_finite)
            && self.y.is_some_and(f64::is_finite)
    }
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Anchor {
    pub gaze: f64,
    pub media: f64,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Keyframe {
    pub t: f64,
    pub points: Vec<[f64; 2]>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Aoi {
    pub id: String,
    pub name: String,
    pub shape: String,
    pub start: f64,
    pub end: f64,
    pub keyframes: Vec<Keyframe>,
    pub source: String,
    pub model: Option<String>,
    pub accepted: bool,
}
impl Aoi {
    pub fn automatic(&self) -> bool {
        self.source == "model"
            || self
                .model
                .as_ref()
                .is_some_and(|m| m.starts_with("recorded-dom:"))
    }
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub method: String,
    pub velocity: f64,
    pub dispersion: f64,
    pub min_fixation: f64,
    pub max_gap: f64,
    pub participant: String,
    pub start: f64,
    pub end: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub aoi_scope: Option<String>,
}
#[derive(Clone, Debug, Deserialize)]
pub struct Recording {
    pub duration: f64,
    pub samples: Vec<Gaze>,
    pub aois: Vec<Aoi>,
    pub anchors: Vec<Anchor>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Fixation {
    pub start: f64,
    pub end: f64,
    pub x: f64,
    pub y: f64,
    pub participant: String,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Metric {
    pub id: String,
    pub name: String,
    pub dwell: f64,
    pub visits: usize,
    pub ttff: Option<f64>,
    pub fixation_count: usize,
    pub fixation_duration: f64,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Transition {
    pub from: String,
    pub to: String,
    pub count: usize,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Sequence {
    pub start: f64,
    pub end: f64,
    pub aoi: Option<String>,
    pub participant: String,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Pupil {
    pub mean: Option<f64>,
    pub count: usize,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Velocity {
    pub t: f64,
    pub v: f64,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Analysis {
    pub samples: usize,
    pub valid_samples: usize,
    pub duration: f64,
    pub valid_time: f64,
    pub coverage: f64,
    pub median_hz: f64,
    pub gaps: usize,
    pub fixations: Vec<Fixation>,
    pub aoi: Vec<Metric>,
    pub transitions: Vec<Transition>,
    pub sequences: Vec<Sequence>,
    pub pupil: Pupil,
    pub blink_samples: usize,
    pub velocities: Vec<Velocity>,
    pub parameters: Settings,
    pub version: String,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Partial {
    pub result: Analysis,
    pub intervals: Vec<f64>,
    pub pupil_sum: f64,
}
