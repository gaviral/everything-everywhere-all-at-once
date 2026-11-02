//! Tunnel mode: a friend reaches one core from anywhere through an HTTPS link (`scripts/trial.sh`), so their
//! browser allows the microphone and nothing has to be installed on their laptop.
//!
//! The tunnel's client (cloudflared) runs on this machine, so every request reaches the core from 127.0.0.1
//! with the tunnel's name as its Host. The plain gate refuses all of them, and trusting 127.0.0.1 instead
//! would make every visitor the host (adding to this laptop's Reminders, importing with its key). With
//! PUBLIC_URL set, the core accepts only requests that name the tunnel and carry the visitor's address,
//! treats each one as a guest from that address, and always asks for the room code. Nothing reaches it
//! any other way: it listens on 127.0.0.1 only, and this laptop's own localhost is refused too.

use crate::{Access, Link};
use std::net::IpAddr;

/// The header Cloudflare sets to the visitor's address; it replaces any value the visitor sends.
pub const VISITOR: axum::http::HeaderName = axum::http::HeaderName::from_static("cf-connecting-ip");

/// Codes shorter than this are refused in tunnel mode: the link is on the internet, not a home network.
const SHORTEST_CODE: usize = 10;

/// The public origin a tunnel serves this core at, e.g. "https://quiet-river-12.trycloudflare.com".
#[derive(Clone, Debug)]
pub struct Tunnel {
    origin: String,
    host: String,
}

impl Tunnel {
    /// PUBLIC_URL turns tunnel mode on; it needs a room code, since the link alone must never open the map.
    pub fn from_env(code: Option<&str>) -> anyhow::Result<Option<Tunnel>> {
        Tunnel::open(std::env::var("PUBLIC_URL").ok().as_deref(), code)
    }

    fn open(url: Option<&str>, code: Option<&str>) -> anyhow::Result<Option<Tunnel>> {
        let Some(url) = url.filter(|u| !u.trim().is_empty()) else { return Ok(None) };
        let tunnel = Tunnel::parse(&url).map_err(|why| anyhow::anyhow!("PUBLIC_URL={url:?}: {why}"))?;
        match code {
            None => anyhow::bail!("PUBLIC_URL needs ROOM_CODE too (scripts/trial.sh sets both)"),
            Some(code) if code.len() < SHORTEST_CODE => {
                anyhow::bail!("PUBLIC_URL needs a ROOM_CODE of at least {SHORTEST_CODE} letters and digits: the link is on the internet")
            }
            Some(_) => Ok(Some(tunnel)),
        }
    }

    /// Only an HTTPS origin: a browser gives the microphone to secure pages only.
    pub fn parse(url: &str) -> Result<Tunnel, &'static str> {
        let url = url.trim().trim_end_matches('/').to_ascii_lowercase();
        let host = url.strip_prefix("https://").ok_or("it must start with https://")?;
        if host.is_empty() || host.contains(|c: char| matches!(c, '/' | '?' | '#' | '@' | '\\') || c.is_whitespace() || c.is_control()) {
            return Err("it must be an origin only, like https://name.trycloudflare.com");
        }
        Ok(Tunnel { origin: url.clone(), host: host.into() })
    }

    pub fn origin(&self) -> &str {
        &self.origin
    }
}

/// What a request through the tunnel may reach, and the visitor's address to treat it as coming from.
/// It must come from this machine (the tunnel's client), name the tunnel as its Host, carry a visitor
/// address that isn't this machine's, and, from a browser, be sent by the tunnel's own page.
pub fn access(tunnel: &Tunnel, link: Link, host: Option<&str>, origin: Option<&str>, visitor: Option<&str>, has_code: bool) -> (Access, Option<IpAddr>) {
    let refused = (Access::None, None);
    if !link.from.ip().is_loopback() || !host.is_some_and(|h| h.eq_ignore_ascii_case(&tunnel.host)) {
        return refused;
    }
    let Some(visitor) = visitor.and_then(|v| v.trim().parse::<IpAddr>().ok()) else { return refused };
    // A visitor who "comes from" this machine would be the host.
    if visitor.is_loopback() || visitor.is_unspecified() {
        return refused;
    }
    if !origin.is_none_or(|o| o.eq_ignore_ascii_case(&tunnel.origin)) {
        return refused;
    }
    (if has_code { Access::Map } else { Access::Page }, Some(visitor))
}

#[cfg(test)]
mod tests {
    use super::{access, Tunnel};
    use crate::{Access, Link};

    fn tunnel() -> Tunnel {
        Tunnel::parse("https://quiet-river-12.trycloudflare.com/").unwrap()
    }

    fn from(address: &str) -> Link {
        Link { from: address.parse().unwrap(), to: "127.0.0.1:4410".parse().unwrap(), tls: false }
    }

    const HOST: Option<&str> = Some("quiet-river-12.trycloudflare.com");
    const PAGE: Option<&str> = Some("https://quiet-river-12.trycloudflare.com");
    const FRIEND: Option<&str> = Some("203.0.113.7");

    #[test]
    fn through_the_tunnel_a_visitor_needs_the_code_and_is_never_the_host() {
        let cloudflared = from("127.0.0.1:50000");
        let (map, visitor) = access(&tunnel(), cloudflared, HOST, PAGE, FRIEND, true);
        assert_eq!(map, Access::Map);
        let visitor = visitor.unwrap();
        assert!(!visitor.is_loopback(), "the gate swaps in the visitor's address, so `here()` is false for them");
        assert_eq!(visitor.to_string(), "203.0.113.7");
        assert_eq!(access(&tunnel(), cloudflared, HOST, None, FRIEND, true).0, Access::Map, "no Origin: still needs the code");
        // Without the code: the page, to type it in, but not the map.
        assert_eq!(access(&tunnel(), cloudflared, HOST, PAGE, FRIEND, false).0, Access::Page);
        assert_eq!(access(&tunnel(), cloudflared, HOST, None, FRIEND, false).0, Access::Page);
        assert_eq!(access(&tunnel(), cloudflared, Some("QUIET-river-12.trycloudflare.com"), PAGE, Some(" 2001:db8::7 "), true).0, Access::Map);
    }

    #[test]
    fn tunnel_mode_refuses_every_other_way_in() {
        let cloudflared = from("127.0.0.1:50000");
        // Other sites, and pages from this laptop: no one here is the host, and localhost isn't the tunnel.
        for bad in ["https://example.com", "http://quiet-river-12.trycloudflare.com", "https://quiet-river-12.trycloudflare.com.evil.com",
            "http://localhost:4410", "http://127.0.0.1:4410", "null"] {
            assert_eq!(access(&tunnel(), cloudflared, HOST, Some(bad), FRIEND, true).0, Access::None, "origin {bad}");
        }
        for bad in ["localhost:4410", "127.0.0.1:4410", "example.com", "quiet-river-12.trycloudflare.com.evil.com", "other.trycloudflare.com"] {
            assert_eq!(access(&tunnel(), cloudflared, Some(bad), PAGE, FRIEND, true).0, Access::None, "host {bad}");
        }
        assert_eq!(access(&tunnel(), cloudflared, None, PAGE, FRIEND, true).0, Access::None, "no Host");
        // No visitor address means it didn't come through the tunnel; one naming this machine would make them the host.
        for bad in [None, Some(""), Some("not-an-ip"), Some("127.0.0.1"), Some("::1"), Some("0.0.0.0"), Some("203.0.113.7, 10.0.0.1")] {
            assert_eq!(access(&tunnel(), cloudflared, HOST, PAGE, bad, true).0, Access::None, "visitor {bad:?}");
        }
        // The core listens on 127.0.0.1 only; anything else reaching it is refused regardless.
        assert_eq!(access(&tunnel(), from("192.168.1.9:51000"), HOST, PAGE, FRIEND, true).0, Access::None);
    }

    #[test]
    fn public_url_is_an_https_origin_and_needs_a_long_code() {
        assert_eq!(Tunnel::parse(" https://Quiet-River-12.trycloudflare.com/ ").unwrap().origin(), "https://quiet-river-12.trycloudflare.com");
        assert_eq!(Tunnel::parse("https://friend.example.com:8443").unwrap().host, "friend.example.com:8443");
        for bad in ["http://quiet-river-12.trycloudflare.com", "quiet-river-12.trycloudflare.com", "https://", "https://a.com/path",
            "https://a.com?x=1", "https://user@a.com", "https://a .com"] {
            assert!(Tunnel::parse(bad).is_err(), "{bad}");
        }
        let url = Some("https://quiet-river-12.trycloudflare.com");
        assert!(Tunnel::open(None, None).unwrap().is_none(), "off unless set");
        assert!(Tunnel::open(Some(" "), Some("k7m2x9qpab")).unwrap().is_none());
        assert!(Tunnel::open(url, None).is_err(), "never without a code");
        assert!(Tunnel::open(url, Some("k7m2x9qp")).is_err(), "8 is fine on a home network, not on the internet");
        assert!(Tunnel::open(url, Some("k7m2x9qpab")).unwrap().is_some());
        assert!(Tunnel::open(Some("http://quiet-river-12.trycloudflare.com"), Some("k7m2x9qpab")).is_err());
    }
}
