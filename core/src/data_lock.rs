//! One core per map folder. The OS lock lives until the returned file is dropped.

use anyhow::{Context, Result};
use std::fs::{self, File, OpenOptions, TryLockError};
use std::path::Path;

const LOCK_FILE: &str = ".core.lock";

/// Acquire the map's startup lock without waiting. Keep the sidecar in place even
/// after releasing the lock: removing it could let another core lock a different file.
pub fn acquire(data: &Path) -> Result<File> {
    fs::create_dir_all(data)
        .with_context(|| format!("couldn't create map folder {}", data.display()))?;
    let path = data.join(LOCK_FILE);
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(&path)
        .with_context(|| format!("couldn't open map lock {}", path.display()))?;
    match file.try_lock() {
        Ok(()) => Ok(file),
        Err(TryLockError::WouldBlock) => anyhow::bail!(
            "another core has this map open at {}; use a different map folder",
            data.display()
        ),
        Err(TryLockError::Error(error)) => {
            Err(error).with_context(|| format!("couldn't lock map folder {}", data.display()))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::process::{Child, Command, ExitStatus};
    use std::time::{Duration, Instant};

    const PROBE_DIR: &str = "E2A2O_DATA_LOCK_TEST_DIR";
    const PROBE_MODE: &str = "E2A2O_DATA_LOCK_TEST_MODE";
    const TIMEOUT: Duration = Duration::from_secs(10);

    struct TempDir(PathBuf);

    impl TempDir {
        fn new() -> Self {
            let path =
                std::env::temp_dir().join(format!("e2a2o-data-lock-{}", uuid::Uuid::new_v4()));
            fs::create_dir(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn assert_contention(data: &Path) {
        let start = Instant::now();
        let error = acquire(data).unwrap_err();
        assert!(
            start.elapsed() < Duration::from_secs(1),
            "contention should return promptly"
        );
        let message = error.to_string();
        assert!(
            message.contains("another core has this map open"),
            "{message}"
        );
        assert!(message.contains("different map folder"), "{message}");
    }

    #[test]
    fn same_directory_contends() {
        let data = TempDir::new();
        let _holder = acquire(&data.0).unwrap();
        assert_contention(&data.0);
    }

    #[test]
    fn different_directories_are_independent() {
        let first = TempDir::new();
        let second = TempDir::new();
        let _first_holder = acquire(&first.0).unwrap();
        let _second_holder = acquire(&second.0).unwrap();
        assert_contention(&first.0);
        assert_contention(&second.0);
    }

    #[test]
    fn dropping_holder_allows_reacquisition_with_sidecar_kept() {
        let data = TempDir::new();
        let path = data.0.join(LOCK_FILE);
        fs::write(&path, b"existing sidecar contents").unwrap();
        let holder = acquire(&data.0).unwrap();
        assert_contention(&data.0);
        drop(holder);
        assert!(path.is_file());
        // A concurrent test can spawn a child that briefly inherits the handle
        // before exec closes it. Wait for those handles to close as well.
        let deadline = Instant::now() + TIMEOUT;
        let _next_holder = loop {
            match acquire(&data.0) {
                Ok(file) => break file,
                Err(error) => {
                    assert!(
                        Instant::now() < deadline,
                        "lock was not released: {error:#}"
                    );
                    std::thread::sleep(Duration::from_millis(10));
                }
            }
        };
        assert_eq!(fs::read(&path).unwrap(), b"existing sidecar contents");
    }

    #[test]
    fn creates_missing_map_directory() {
        let data = TempDir::new();
        let folder = data.0.join("new-map");
        let _holder = acquire(&folder).unwrap();
        assert!(folder.join(LOCK_FILE).is_file());
    }

    #[test]
    fn filesystem_errors_preserve_their_reason() {
        let data = TempDir::new();
        let not_a_directory = data.0.join("file");
        fs::write(&not_a_directory, b"").unwrap();
        let error = acquire(&not_a_directory).unwrap_err();
        assert!(error.downcast_ref::<std::io::Error>().is_some());
        assert!(error.to_string().contains("couldn't create map folder"));
        assert!(!error.to_string().contains("another core"));

        fs::create_dir(data.0.join(LOCK_FILE)).unwrap();
        let error = acquire(&data.0).unwrap_err();
        assert!(error.downcast_ref::<std::io::Error>().is_some());
        assert!(error.to_string().contains("couldn't open map lock"));
        assert!(!error.to_string().contains("another core"));
    }

    // Run only this test in a fresh copy of the current test executable. No map or
    // server is started, and each child gets its own mode through Command::env.
    #[test]
    fn child_process_probe() {
        let Some(data) = std::env::var_os(PROBE_DIR) else {
            return;
        };
        let data = PathBuf::from(data);
        match std::env::var(PROBE_MODE).unwrap().as_str() {
            "contend" => assert_contention(&data),
            "acquire" => {
                let _holder = acquire(&data).unwrap();
            }
            "hold" => {
                let _holder = acquire(&data).unwrap();
                fs::write(data.join("ready"), b"").unwrap();
                // The parent kills this process while the lock is held. Bound the
                // child's lifetime too, in case the parent unexpectedly exits.
                std::thread::sleep(TIMEOUT);
                panic!("parent did not stop the holding process in time");
            }
            mode => panic!("unknown probe mode: {mode}"),
        }
    }

    struct Probe(Child);

    impl Probe {
        fn spawn(data: &Path, mode: &str) -> Self {
            Self(
                Command::new(std::env::current_exe().unwrap())
                    .args([
                        "--exact",
                        "data_lock::tests::child_process_probe",
                        "--nocapture",
                    ])
                    .env(PROBE_DIR, data)
                    .env(PROBE_MODE, mode)
                    .spawn()
                    .unwrap(),
            )
        }

        fn wait(&mut self) -> ExitStatus {
            let deadline = Instant::now() + TIMEOUT;
            loop {
                if let Some(status) = self.0.try_wait().unwrap() {
                    return status;
                }
                assert!(Instant::now() < deadline, "child probe timed out");
                std::thread::sleep(Duration::from_millis(10));
            }
        }

        fn wait_until_ready(&mut self, data: &Path) {
            let deadline = Instant::now() + TIMEOUT;
            while !data.join("ready").exists() {
                assert!(
                    self.0.try_wait().unwrap().is_none(),
                    "holder exited before acquiring lock"
                );
                assert!(
                    Instant::now() < deadline,
                    "holder did not acquire lock in time"
                );
                std::thread::sleep(Duration::from_millis(10));
            }
        }
    }

    impl Drop for Probe {
        fn drop(&mut self) {
            // Reap children on assertion failures too, before TempDir cleans up.
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }

    #[test]
    fn contention_and_release_across_processes() {
        let data = TempDir::new();
        let holder = acquire(&data.0).unwrap();
        assert!(Probe::spawn(&data.0, "contend").wait().success());
        drop(holder);

        let mut holder = Probe::spawn(&data.0, "hold");
        holder.wait_until_ready(&data.0);
        assert!(Probe::spawn(&data.0, "contend").wait().success());
        holder.0.kill().unwrap();
        assert!(!holder.wait().success());
        assert!(data.0.join(LOCK_FILE).is_file());
        assert!(Probe::spawn(&data.0, "acquire").wait().success());
        let _next_holder = acquire(&data.0).unwrap();
    }
}
