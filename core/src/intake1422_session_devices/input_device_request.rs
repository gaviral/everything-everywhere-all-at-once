use std::collections::BTreeMap;
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum InputState {
    Requested,
    Confirmed,
    Active,
    Denied,
    Stopped,
}
#[derive(Clone, Debug)]
pub struct InputRequest {
    pub id: u64,
    pub session: String,
    pub device: String,
    pub requested_by: String,
    pub expected_fence: u64,
    pub expires_at: u64,
    pub state: InputState,
}
#[derive(Default)]
pub(super) struct RequestBook {
    serial: u64,
    rows: BTreeMap<u64, InputRequest>,
}
impl RequestBook {
    pub fn create(
        &mut self,
        session: &str,
        device: &str,
        requested_by: &str,
        expected_fence: u64,
        now: u64,
    ) -> InputRequest {
        self.serial = self.serial.checked_add(1).expect("request IDs exhausted");
        for row in self.rows.values_mut() {
            if row.session == session
                && row.requested_by == requested_by
                && row.state != InputState::Active
            {
                row.state = InputState::Stopped;
            }
        }
        let row = InputRequest {
            id: self.serial,
            session: session.into(),
            device: device.into(),
            requested_by: requested_by.into(),
            expected_fence,
            expires_at: now.saturating_add(10000),
            state: InputState::Requested,
        };
        self.rows.insert(row.id, row.clone());
        row
    }
    pub fn confirm(
        &mut self,
        id: u64,
        endpoint: &str,
        allowed: bool,
        connected: bool,
        now: u64,
    ) -> Option<InputRequest> {
        let row = self.rows.get_mut(&id)?;
        if row.state != InputState::Requested || row.device != endpoint {
            return None;
        }
        if now >= row.expires_at || !connected {
            row.state = InputState::Stopped;
            return None;
        }
        row.state = if allowed {
            InputState::Confirmed
        } else {
            InputState::Denied
        };
        allowed.then(|| row.clone())
    }
    pub fn claimed(&mut self, id: u64, won: bool) {
        if let Some(row) = self.rows.get_mut(&id) {
            row.state = if won {
                InputState::Active
            } else {
                InputState::Denied
            };
        }
    }
    pub fn stop(&mut self, id: u64) {
        if let Some(row) = self.rows.get_mut(&id) {
            row.state = InputState::Stopped;
        }
    }
    pub fn stop_all(&mut self) {
        for row in self.rows.values_mut() {
            row.state = InputState::Stopped;
        }
    }
    pub fn disconnect(&mut self, session: &str, device: &str) {
        for row in self.rows.values_mut() {
            if row.session == session && row.device == device {
                row.state = InputState::Stopped;
            }
        }
    }
}
