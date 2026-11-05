use super::InputRequest;
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ListenerLease {
    pub session: String,
    pub device: String,
    pub request_id: u64,
    pub fence: u64,
    pub expires_at: u64,
}
#[derive(Default)]
pub(super) struct LeaseSlot {
    pub fence: u64,
    pub current: Option<ListenerLease>,
}
impl LeaseSlot {
    pub fn expire(&mut self, now: u64) {
        if self
            .current
            .as_ref()
            .is_some_and(|lease| now >= lease.expires_at)
        {
            self.release_current();
        }
    }
    pub fn release_current(&mut self) {
        if self.current.take().is_some() {
            self.fence = self.fence.checked_add(1).expect("fence exhausted");
        }
    }
    pub fn grant(&mut self, request: &InputRequest, now: u64) -> Option<ListenerLease> {
        self.expire(now);
        if self.current.is_some() || self.fence != request.expected_fence {
            return None;
        }
        self.fence = self.fence.checked_add(1).expect("fence exhausted");
        let lease = ListenerLease {
            session: request.session.clone(),
            device: request.device.clone(),
            request_id: request.id,
            fence: self.fence,
            expires_at: now.checked_add(5000)?,
        };
        self.current = Some(lease.clone());
        Some(lease)
    }
}
