//! Shared classification of provider **content-policy** rejections.
//!
//! Lives in `goose-provider-types` because two different layers have to agree on it:
//! the HTTP status mapping in `goose-providers::http_status` (a 400 whose body is
//! JSON, or SSE-framed JSON) and the streaming decoder in [`crate::formats::openai`]
//! (an error frame arriving inside an HTTP 200). The streaming layer cannot reach
//! into `goose-providers`, so the marker list and the guidance live here.
//!
//! This class of failure is worth separating from "malformed request" because it is
//! permanent for a given conversation: the history is rebuilt identically on every
//! turn, so a rejection of text that is already *in* that history fails the same way
//! forever. Surfacing it as a generic "Bad request" invites an agent to retry a wall,
//! and each retry replays the same content back to the filter that just rejected it.

use serde_json::Value;

use crate::errors::ProviderError;

/// Markers matched against the **structured** error fields (`error.code`,
/// `error.type`, `error.param`, `code`, `type`) only.
///
/// These are identifier-shaped tokens, so a match is authoritative: a gateway that
/// sets `code: "DataInspectionFailed"` is telling us which subsystem answered. The
/// matching phrases that live in prose are deliberately NOT in this list because
/// they also appear in account/entitlement notices ("you must accept our content
/// policy", "not available under your usage policy") where a new session changes
/// nothing but a settings change fixes everything.
const CONTENT_INSPECTION_CODE_MARKERS: &[&str] = &[
    "datainspectionfailed",
    "data_inspection_failed",
    "contentinspectionfailed",
    "content_inspection_failed",
    "content_inspection",
    "inspection_failed",
    "moderation_blocked",
    "content_filtered",
    "content_filter",
    "contentpolicy",
    "content_policy",
    "usage_policy",
    "responsibleaipolicyviolation",
];

/// Markers matched against the message text. Each is an explicit description of a
/// filter refusing content, specific enough that it is not also how a gateway
/// describes a plan, a quota, or a bad parameter name.
const CONTENT_INSPECTION_MESSAGE_MARKERS: &[&str] = &[
    "inappropriate content",
    "content management policy",
    "was filtered due to",
    "filtered due to",
    "content filter",
    "content-filter",
    "content policy violation",
    "moderation flag",
    "responsible ai",
    "safety system",
];

/// Appended to a detected content rejection: the one fact a retrying agent cannot
/// infer from the response, namely that retrying the identical request cannot
/// succeed, and how an operator can see the raw provider body.
///
/// Deliberately avoids telling the user to start a new session:
/// `crate::conversation::message` already renders that advice for
/// `ProviderError::Refusal`, and duplicating it makes the whole rejection read like
/// a stack trace. It also names no log path, because the path is
/// platform-and-interface dependent; `request_id` and the engine log are the way to
/// find the body.
pub const CONTENT_POLICY_GUIDANCE: &str = " [content-policy rejection: the provider's content filter rejected this request, and the same history is rebuilt on every turn, so retrying it cannot succeed. Set GOOSE_ERROR_BODY_PREVIEW=1 to append the raw provider error body to this message; it is always written to the goose engine log.]";

/// Lowercased string at an object path, if present and a string.
fn lower_str_at(payload: &Value, path: &[&str]) -> Option<String> {
    let mut node = payload;
    for key in path {
        node = node.get(*key)?;
    }
    node.as_str().map(|s| s.to_ascii_lowercase())
}

/// Which content-inspection marker explains this rejection, if any.
///
/// Only inspects the *structured* error fields plus the message the caller was
/// already going to show: it never echoes the raw body from here, so a hostile body
/// cannot use these markers to get text into history.
pub fn content_policy_reason(payload: Option<&Value>, message: &str) -> Option<&'static str> {
    if let Some(payload) = payload {
        let mut fields: Vec<String> = Vec::new();
        for path in [
            ["error", "code"].as_slice(),
            ["error", "type"].as_slice(),
            ["error", "param"].as_slice(),
            ["code"].as_slice(),
            ["type"].as_slice(),
        ] {
            fields.extend(lower_str_at(payload, path));
        }
        if let Some(marker) = fields.iter().find_map(|field| {
            CONTENT_INSPECTION_CODE_MARKERS
                .iter()
                .find(|marker| field.contains(*marker))
                .copied()
        }) {
            return Some(marker);
        }
    }

    let message = message.to_ascii_lowercase();
    CONTENT_INSPECTION_MESSAGE_MARKERS
        .iter()
        .find(|marker| message.contains(*marker))
        .copied()
}

/// A `Refusal` for a content-policy rejection, or `None` when nothing marks it as
/// one. `details` is the provider's own message plus [`CONTENT_POLICY_GUIDANCE`];
/// callers that fold a request id into the message should append it *after* that so
/// `http_status::parse_request_id_suffix` can still recover it.
pub fn content_policy_refusal(payload: Option<&Value>, message: &str) -> Option<ProviderError> {
    content_policy_reason(payload, message).map(|marker| ProviderError::Refusal {
        details: format!("{message}{CONTENT_POLICY_GUIDANCE}"),
        category: Some(marker.to_string()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn dashscope_code_in_the_code_field_is_authoritative() {
        let payload = json!({ "code": "DataInspectionFailed", "message": "Input data may contain inappropriate content." });
        assert_eq!(
            content_policy_reason(
                Some(&payload),
                "Input data may contain inappropriate content."
            ),
            Some("datainspectionfailed")
        );
    }

    #[test]
    fn nested_openai_error_code_is_read_too() {
        let payload = json!({ "error": { "code": "data_inspection_failed", "message": "x" } });
        assert!(content_policy_reason(Some(&payload), "x").is_some());
    }

    /// The false positive this split exists to prevent: an account notice that
    /// happens to use the words "content policy" is a recoverable configuration
    /// problem, not a filter rejection, and must not be reported as permanent.
    #[test]
    fn entitlement_prose_is_not_mistaken_for_a_filter_rejection() {
        let payload = json!({
            "error": {
                "message": "You must accept the updated content policy before using this model.",
                "type": "invalid_request_error"
            }
        });
        assert_eq!(
            content_policy_reason(
                Some(&payload),
                "You must accept the updated content policy before using this model."
            ),
            None
        );
    }

    #[test]
    fn explicit_filter_prose_in_the_message_is_enough() {
        for message in [
            "The response was filtered due to the prompt triggering our content filter.",
            "Input data may contain inappropriate content.",
            "Your request was blocked by the Azure OpenAI content management policy.",
        ] {
            assert!(
                content_policy_reason(None, message).is_some(),
                "expected a marker in: {message}"
            );
        }
    }

    #[test]
    fn unrelated_bad_requests_are_not_refusals() {
        assert_eq!(content_policy_reason(None, ""), None);
        assert_eq!(
            content_policy_reason(
                Some(&json!({ "error": { "code": "rate_limit_exceeded" } })),
                "slow down"
            ),
            None
        );
        assert_eq!(
            content_policy_reason(
                Some(&json!({ "error": { "message": "unknown parameter: temperature" } })),
                "unknown parameter: temperature"
            ),
            None
        );
    }

    #[test]
    fn refusal_carries_the_marker_as_category() {
        let err = content_policy_refusal(
            Some(&json!({ "error": { "code": "moderation_blocked" } })),
            "blocked",
        )
        .expect("code marker should classify");
        match err {
            ProviderError::Refusal { details, category } => {
                assert_eq!(category.as_deref(), Some("moderation_blocked"));
                assert!(details.starts_with("blocked"), "got {details}");
                assert!(
                    details.contains("content-policy rejection"),
                    "guidance missing: {details}"
                );
            }
            other => panic!("expected a refusal, got {other:?}"),
        }
    }

    #[test]
    fn guidance_does_not_break_the_request_id_suffix_shape() {
        // `parse_request_id_suffix` locates its label by search, but the guidance is
        // still what a user reads last, so keep it free of a second id-looking suffix.
        assert!(
            !CONTENT_POLICY_GUIDANCE.contains("provider request id:"),
            "guidance must not imitate the request id suffix"
        );
    }
}
