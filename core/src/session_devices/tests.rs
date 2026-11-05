use super::*;
use std::sync::{Arc, Barrier};
#[test]
fn simultaneous_confirmations_have_one_winner() {
    let authority = Arc::new(SessionAuthority::default());
    assert!(!DEFAULT_ENABLED);
    assert!(authority
        .request("shared", "phone", "phone", 0, true)
        .is_none());
    authority.set_enabled(true);
    let a = authority
        .request("shared", "phone", "phone", 0, true)
        .unwrap();
    let b = authority
        .request("shared", "desktop", "desktop", 0, true)
        .unwrap();
    let barrier = Arc::new(Barrier::new(2));
    let jobs: Vec<_> = [a, b]
        .into_iter()
        .map(|request| {
            let authority = authority.clone();
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                barrier.wait();
                authority.confirm_and_claim(request.id, &request.device, true, true, 1)
            })
        })
        .collect();
    let winners: Vec<_> = jobs
        .into_iter()
        .filter_map(|job| job.join().unwrap())
        .collect();
    assert_eq!(winners.len(), 1);
    assert_eq!(authority.listener("shared", 2), Some(winners[0].clone()));
    assert!(authority.listener("other", 2).is_none());
}
#[test]
fn request_confirmation_release_and_expiry_fail_closed() {
    let authority = SessionAuthority::default();
    authority.set_enabled(true);
    let remote = authority
        .request("shared", "desktop", "desktop", 0, true)
        .unwrap();
    assert!(authority.listener("shared", 1).is_none());
    assert!(authority
        .confirm_and_claim(remote.id, "phone", true, true, 1)
        .is_none());
    assert!(authority
        .confirm_and_claim(remote.id, "desktop", false, true, 1)
        .is_none());
    assert!(authority
        .confirm_and_claim(remote.id, "desktop", true, true, 2)
        .is_none());
    let stale = authority
        .request("shared", "desktop", "desktop", 3, true)
        .unwrap();
    assert!(authority
        .confirm_and_claim(stale.id, "desktop", true, true, 10003)
        .is_none());
    let old = authority
        .request("shared", "desktop", "desktop", 10004, true)
        .unwrap();
    let newer = authority
        .request("shared", "desktop", "desktop", 10004, true)
        .unwrap();
    assert!(authority
        .confirm_and_claim(old.id, "desktop", true, true, 10005)
        .is_none());
    let lease = authority
        .confirm_and_claim(newer.id, "desktop", true, true, 10005)
        .unwrap();
    authority.stop("shared", lease.fence + 1, 10006);
    assert_eq!(authority.listener("shared", 10006), Some(lease.clone()));
    assert!(authority.listener("shared", lease.expires_at).is_none());
    assert!(authority
        .confirm_and_claim(newer.id, "desktop", true, true, lease.expires_at)
        .is_none());
    let fresh = authority
        .request("shared", "desktop", "desktop", 16000, true)
        .unwrap();
    let active = authority
        .confirm_and_claim(fresh.id, "desktop", true, true, 16001)
        .unwrap();
    authority.disconnect("shared", "desktop");
    assert!(authority.listener("shared", 16002).is_none());
    authority.stop("shared", active.fence, 16003);
    let pending = authority
        .request("shared", "phone", "phone", 16004, true)
        .unwrap();
    authority.set_enabled(false);
    authority.set_enabled(true);
    assert!(authority
        .confirm_and_claim(pending.id, "phone", true, true, 16005)
        .is_none());
    assert!(authority.listener("shared", 16006).is_none());
}

#[test]
fn controller_selection_and_fencing_invalidate_old_confirmation() {
    let authority = SessionAuthority::default();
    authority.set_enabled(true);
    let old = authority
        .request("shared", "desktop", "tablet", 0, true)
        .unwrap();
    let changed = authority
        .request("shared", "phone", "tablet", 0, true)
        .unwrap();
    assert!(authority
        .confirm_and_claim(old.id, "desktop", true, true, 1)
        .is_none());
    let competing = authority
        .request("shared", "desktop", "desktop", 0, true)
        .unwrap();
    let winner = authority
        .confirm_and_claim(changed.id, "phone", true, true, 1)
        .unwrap();
    authority.stop("shared", winner.fence, 2);
    assert!(authority
        .confirm_and_claim(competing.id, "desktop", true, true, 3)
        .is_none());
    assert!(authority.listener("shared", 3).is_none());
}
