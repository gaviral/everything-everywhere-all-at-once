//! Fixture-compilable shared authority. Host routes/registration are deliberately external.
//! One instance must be shared by all endpoints in its scope. Host handlers authenticate
//! the local endpoint, supply authoritative connection state and use a monotonic clock.
mod input_device_request;
mod listener_lease;
#[cfg(test)]
mod tests;

use input_device_request::RequestBook;
pub use input_device_request::{InputRequest, InputState};
use listener_lease::LeaseSlot;
pub use listener_lease::ListenerLease;
use std::collections::BTreeMap;
use std::sync::Mutex;

pub const FEATURE_ID: &str = "intake1422-session-devices";
pub const DEFAULT_ENABLED: bool = false;

#[derive(Default)]
struct AuthorityState {
    enabled: bool,
    slots: BTreeMap<String, LeaseSlot>,
    requests: RequestBook,
}
#[derive(Default)]
pub struct SessionAuthority {
    state: Mutex<AuthorityState>,
}
impl SessionAuthority {
    pub fn set_enabled(&self, enabled: bool) {
        let mut state = self.state.lock().expect("authority poisoned");
        state.enabled = enabled;
        if !enabled {
            for slot in state.slots.values_mut() {
                slot.release_current();
            }
            state.requests.stop_all();
        }
    }
    pub fn request(
        &self,
        session: &str,
        device: &str,
        requested_by: &str,
        now: u64,
        connected: bool,
    ) -> Option<InputRequest> {
        let mut state = self.state.lock().expect("authority poisoned");
        if !state.enabled || !connected {
            return None;
        }
        let slot = state.slots.entry(session.into()).or_default();
        slot.expire(now);
        let fence = slot.fence;
        Some(
            state
                .requests
                .create(session, device, requested_by, fence, now),
        )
    }
    /// `local_endpoint` must come from the trusted local confirmation handler, never
    /// from a remote selection payload. No audio is started by this module.
    pub fn confirm_and_claim(
        &self,
        request_id: u64,
        local_endpoint: &str,
        allowed: bool,
        connected: bool,
        now: u64,
    ) -> Option<ListenerLease> {
        let mut state = self.state.lock().expect("authority poisoned");
        if !state.enabled {
            return None;
        }
        let request =
            state
                .requests
                .confirm(request_id, local_endpoint, allowed, connected, now)?;
        let slot = state.slots.entry(request.session.clone()).or_default();
        let lease = slot.grant(&request, now);
        state.requests.claimed(request_id, lease.is_some());
        lease
    }
    pub fn listener(&self, session: &str, now: u64) -> Option<ListenerLease> {
        let mut state = self.state.lock().expect("authority poisoned");
        let slot = state.slots.entry(session.into()).or_default();
        slot.expire(now);
        slot.current.clone()
    }
    /// A fenced stop cannot release a newer listener's lease.
    pub fn stop(&self, session: &str, fence: u64, now: u64) {
        let mut state = self.state.lock().expect("authority poisoned");
        let slot = state.slots.entry(session.into()).or_default();
        slot.expire(now);
        if slot
            .current
            .as_ref()
            .is_some_and(|lease| lease.fence == fence)
        {
            let request = slot.current.as_ref().unwrap().request_id;
            slot.release_current();
            state.requests.stop(request);
        }
    }
    pub fn disconnect(&self, session: &str, device: &str) {
        let mut state = self.state.lock().expect("authority poisoned");
        if let Some(slot) = state.slots.get_mut(session) {
            if slot
                .current
                .as_ref()
                .is_some_and(|lease| lease.device == device)
            {
                slot.release_current();
            }
        }
        state.requests.disconnect(session, device);
    }
}
