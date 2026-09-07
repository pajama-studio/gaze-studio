pub mod analysis;
pub mod events;
pub mod geometry;
pub mod signals;
pub mod types;
use serde::Deserialize;
use wasm_bindgen::prelude::*;
#[derive(Deserialize)]
struct Input {
    recording: types::Recording,
    settings: types::Settings,
}
pub fn analyze_text(input: &str) -> Result<String, String> {
    let i: Input = serde_json::from_str(input).map_err(|e| e.to_string())?;
    serde_json::to_string(&analysis::analyze(i.recording, i.settings)?).map_err(|e| e.to_string())
}
#[wasm_bindgen]
pub fn analyze_json(input: &str) -> Result<String, JsValue> {
    analyze_text(input).map_err(|e| JsValue::from_str(&e))
}
#[wasm_bindgen]
pub fn merge_json(input: &str) -> Result<String, JsValue> {
    let parts: Vec<types::Partial> =
        serde_json::from_str(input).map_err(|e| JsValue::from_str(&e.to_string()))?;
    let result = analysis::merge(parts).map_err(|e| JsValue::from_str(&e))?;
    serde_json::to_string(&result).map_err(|e| JsValue::from_str(&e.to_string()))
}
#[wasm_bindgen]
pub fn engine_version() -> String {
    "gaze-core/0.2.0 rust-wasm".into()
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn malformed_protocol_returns_error() {
        assert!(analyze_text(r#"{"recording":{"duration":100,"samples":[],"aois":[],"anchors":[]},"settings":{"method":"ivt","velocity":800,"dispersion":65,"minFixation":100,"maxGap":75,"participant":"all","start":0,"end":100}}"#).is_err());
    }
    #[test]
    fn offset_and_drift_are_explicit() {
        let a = vec![
            types::Anchor {
                gaze: 0.,
                media: 100.,
            },
            types::Anchor {
                gaze: 1000.,
                media: 1102.,
            },
        ];
        assert_eq!(geometry::map_time(500., &a), 601.);
    }
}

#[wasm_bindgen]
pub fn eye_summary_json(input: &str) -> Result<String, JsValue> {
    let input: signals::Input =
        serde_json::from_str(input).map_err(|e| JsValue::from_str(&e.to_string()))?;
    let result = signals::describe(input).map_err(|e| JsValue::from_str(&e))?;
    serde_json::to_string(&result).map_err(|e| JsValue::from_str(&e.to_string()))
}
