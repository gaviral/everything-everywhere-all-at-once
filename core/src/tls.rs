//! Opt-in room TLS, using axum's Listener so WebSockets and socket-based gates stay unchanged.
use anyhow::Context;
use rustls::pki_types::{CertificateDer, PrivatePkcs8KeyDer};
use serde::{Deserialize, Serialize};
use std::{
    io,
    net::SocketAddr,
    path::Path,
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::net::{TcpListener, TcpStream};
use tokio::task::JoinSet;
use tokio_rustls::{rustls, server::TlsStream, TlsAcceptor};

#[derive(Serialize, Deserialize)]
struct Identity {
    names: Vec<String>,
    renew_at: u64,
    cert: Vec<u8>,
    key: Vec<u8>,
}

impl Identity {
    fn config(&self) -> anyhow::Result<rustls::ServerConfig> {
        // Choose ring explicitly, even if another dependency enables a second crypto provider.
        Ok(rustls::ServerConfig::builder_with_provider(Arc::new(
            rustls::crypto::ring::default_provider(),
        ))
        .with_safe_default_protocol_versions()?
        .with_no_client_auth()
        .with_single_cert(
            vec![CertificateDer::from(self.cert.clone())],
            PrivatePkcs8KeyDer::from(self.key.clone()).into(),
        )?)
    }
}

fn identity(data: &Path, names: Vec<String>) -> anyhow::Result<Identity> {
    let folder = data.join("tls");
    std::fs::create_dir_all(&folder)?;
    let path = folder.join("identity.json");
    let now = SystemTime::now();
    let seconds = now.duration_since(UNIX_EPOCH)?.as_secs();
    match std::fs::read(&path) {
        Ok(bytes) => {
            let saved: Identity = serde_json::from_slice(&bytes)
                .context("Cannot read room TLS identity; restore it or remove tls/identity.json to issue a new certificate")?;
            if saved.names == names && seconds < saved.renew_at {
                return Ok(saved);
            }
            tracing::warn!("Room TLS address/hostname changed or certificate expires soon; issuing a new certificate (guest must accept again)");
        }
        Err(e) if e.kind() == io::ErrorKind::NotFound => {}
        Err(e) => return Err(e.into()),
    }
    let mut params = rcgen::CertificateParams::new(names.clone())?;
    params.not_before = (now - Duration::from_secs(86400)).into();
    params.not_after = (now + Duration::from_secs(365 * 86400)).into();
    params.extended_key_usages = vec![rcgen::ExtendedKeyUsagePurpose::ServerAuth];
    let key = rcgen::KeyPair::generate()?;
    let cert = params.self_signed(&key)?;
    let identity = Identity {
        names,
        renew_at: seconds + 364 * 86400,
        cert: cert.der().to_vec(),
        key: key.serialize_der(),
    };
    // Validate before replacing a working identity. One atomic file keeps the key and cert paired.
    identity.config()?;
    let temporary = folder.join(format!("identity-{}.tmp", uuid::Uuid::new_v4()));
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    use std::io::Write;
    let result = (|| -> anyhow::Result<()> {
        let mut file = options.open(&temporary)?;
        file.write_all(&serde_json::to_vec(&identity)?)?;
        file.sync_all()?;
        std::fs::rename(&temporary, &path)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    result.context("Saving room TLS identity")?;
    Ok(identity)
}

fn names(address: SocketAddr) -> anyhow::Result<Vec<String>> {
    // `hostname` is provided by the supported desktop OSes; no interface-enumeration crate needed.
    let output = std::process::Command::new("hostname")
        .output()
        .context("Reading this machine's hostname")?;
    let hostname = String::from_utf8(output.stdout)?
        .trim()
        .to_ascii_lowercase();
    anyhow::ensure!(
        output.status.success()
            && !hostname.is_empty()
            && hostname.len() <= 253
            && hostname
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'.'),
        "Cannot obtain a DNS hostname for the room certificate"
    );
    let mut names = vec![
        address.ip().to_string(),
        hostname.clone(),
        "localhost".into(),
        "127.0.0.1".into(),
    ];
    if !hostname.contains('.') {
        names.push(format!("{hostname}.local"));
    }
    names.sort();
    names.dedup();
    Ok(names)
}

pub(super) struct Listener {
    tcp: TcpListener,
    acceptor: TlsAcceptor,
    pending: JoinSet<Option<(TlsStream<TcpStream>, crate::Link)>>,
}

impl Listener {
    pub(super) async fn bind(address: SocketAddr, data: &Path) -> anyhow::Result<Self> {
        let tcp = TcpListener::bind(address)
            .await
            .context("Binding room HTTPS listener")?;
        let identity = identity(data, names(address)?)?;
        Ok(Self {
            tcp,
            acceptor: TlsAcceptor::from(Arc::new(identity.config()?)),
            pending: JoinSet::new(),
        })
    }
}

impl axum::serve::Listener for Listener {
    type Io = TlsStream<TcpStream>;
    type Addr = crate::Link;

    async fn accept(&mut self) -> (Self::Io, Self::Addr) {
        loop {
            tokio::select! {
                result = self.pending.join_next(), if !self.pending.is_empty() => {
                    if let Some(Ok(Some(connection))) = result { return connection; }
                }
                // A slow or invalid TLS client must not block everyone else's handshakes.
                (tcp, from) = axum::serve::Listener::accept(&mut self.tcp), if self.pending.len() < 64 => {
                    let acceptor = self.acceptor.clone();
                    self.pending.spawn(async move {
                        let to = tcp.local_addr().ok()?;
                        let tls = tokio::time::timeout(Duration::from_secs(10), acceptor.accept(tcp)).await.ok()?.ok()?;
                        Some((tls, crate::Link { from, to, tls: true }))
                    });
                }
            }
        }
    }

    fn local_addr(&self) -> io::Result<Self::Addr> {
        let to = self.tcp.local_addr()?;
        Ok(crate::Link {
            from: to,
            to,
            tls: true,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn tls_keeps_connection_info_and_websocket_upgrades_with_an_idle_peer() {
        use axum::{
            extract::{
                ws::{Message, WebSocketUpgrade},
                ConnectInfo,
            },
            routing::get,
            Router,
        };
        use futures_util::StreamExt;
        use tokio_rustls::TlsConnector;

        let data = std::env::temp_dir().join(format!("e2a2o-tls-{}", uuid::Uuid::new_v4()));
        let listener = Listener::bind("127.0.0.1:0".parse().unwrap(), &data)
            .await
            .unwrap();
        let address = listener.tcp.local_addr().unwrap();
        let saved: Identity =
            serde_json::from_slice(&std::fs::read(data.join("tls/identity.json")).unwrap())
                .unwrap();
        let mut roots = rustls::RootCertStore::empty();
        roots.add(CertificateDer::from(saved.cert)).unwrap();
        let config = rustls::ClientConfig::builder_with_provider(Arc::new(
            rustls::crypto::ring::default_provider(),
        ))
        .with_safe_default_protocol_versions()
        .unwrap()
        .with_root_certificates(roots)
        .with_no_client_auth();
        let app =
            Router::new().route(
                "/ws",
                get(
                    move |ConnectInfo(link): ConnectInfo<crate::Link>,
                          upgrade: WebSocketUpgrade| async move {
                        assert!(link.tls);
                        assert!(link.here());
                        assert_eq!(link.to, address);
                        upgrade.on_upgrade(|mut socket| async move {
                            socket
                                .send(Message::Text("TLS websocket works".into()))
                                .await
                                .unwrap();
                        })
                    },
                ),
            );
        let server = tokio::spawn(async move {
            axum::serve(
                listener,
                app.into_make_service_with_connect_info::<crate::Link>(),
            )
            .await
            .unwrap();
        });
        // No ClientHello from this peer. It must not stall the next connection.
        let idle = TcpStream::connect(address).await.unwrap();
        tokio::time::timeout(Duration::from_secs(5), async {
            let tcp = TcpStream::connect(address).await.unwrap();
            let tls = TlsConnector::from(Arc::new(config))
                .connect("localhost".try_into().unwrap(), tcp)
                .await
                .unwrap();
            let (mut socket, response) = tokio_tungstenite::client_async(
                format!("wss://localhost:{}/ws", address.port()),
                tls,
            )
            .await
            .unwrap();
            assert_eq!(response.status().as_u16(), 101);
            assert_eq!(
                socket.next().await.unwrap().unwrap().into_text().unwrap(),
                "TLS websocket works"
            );
        })
        .await
        .unwrap();
        drop(idle);
        server.abort();
        let _ = server.await;
        std::fs::remove_dir_all(data).unwrap();
    }

    #[test]
    fn identity_survives_restart_and_rotates_for_new_address_or_expiry() {
        let data = std::env::temp_dir().join(format!("e2a2o-tls-{}", uuid::Uuid::new_v4()));
        let names = vec!["192.168.1.5".into(), "host.local".into()];
        let first = identity(&data, names.clone()).unwrap();
        let second = identity(&data, names).unwrap();
        assert_eq!(first.cert, second.cert);
        assert_eq!(first.key, second.key);
        second.config().unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(data.join("tls/identity.json"))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
        }
        let mut changed = identity(&data, vec!["192.168.1.6".into(), "host.local".into()]).unwrap();
        assert_ne!(first.cert, changed.cert);
        changed.renew_at = 0;
        std::fs::write(
            data.join("tls/identity.json"),
            serde_json::to_vec(&changed).unwrap(),
        )
        .unwrap();
        let renewed = identity(&data, changed.names.clone()).unwrap();
        assert_ne!(changed.cert, renewed.cert);
        std::fs::remove_dir_all(data).unwrap();
    }
}
