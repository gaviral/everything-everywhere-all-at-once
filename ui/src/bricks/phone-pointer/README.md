# Desktop pointer

Off by default; enable **Desktop pointer** in Features for setup. This is a Mac desktop controller, separate from the existing Canvas-only Phone remote. It uses no model and no microphone.

Requires macOS 14+, Python 3 and the Swift command-line tools. Build and launch from this repository:

```
npm --prefix ui run build
python3 ui/src/bricks/phone-pointer/helper.py --bind 0.0.0.0 --host <Mac-LAN-IP>
```

The helper uses port 4387 by default; `--port` chooses another unreserved port. It refuses 4360 and 4399 before binding. Open the printed private pairing link on the phone on the same trusted Wi-Fi. It serves the compiled brick itself, so no core, room, model credentials or dev server is needed. Keep the link private: possession permits desktop input. The fragment key leaves the address bar after mounting and stays in memory only; reloading requires reopening the original link. Restarting the helper invalidates prior links. HTTP is intended for trusted local Wi-Fi; for encrypted transport pass `--cert` and `--key` with a certificate the phone trusts. Keys must stay outside this public repository.

In Mac System Settings → Privacy & Security, grant **Accessibility** to the launching terminal/helper as macOS identifies it. Choose **Check connection** after changing permission. Input works without Screen Recording: slide to move the existing Mac pointer, lift and reposition without jumping, and tap to click wherever that pointer already is. Click and Right click work at that same position. Keyboard modifiers apply to one key and reset after acceptance. Shortcut key accepts a letter or digit; Send text types Unicode without modifiers. Failed text stays in the field. Actions are acknowledged after posting to the OS, not after verification that the foreground application accepted them. Input is never retried.

For optional preview, separately allow **Screen Recording** for the helper, check connection, then press **Start preview**. Each request captures one JPEG of the main display, including its pointer, in memory only, at up to 1280 px wide. The next request starts 800 ms after the previous response; this is a limit, not a measured frame rate. Input uses its own persistent process and works with preview paused or refused. Preview uses neither audio nor the microphone. Switching away, hiding the tab, closing the remote or disabling the brick stops requests and clears the visible frame. An already requested snapshot may finish; returning never resumes capture until another Start. Quit the helper with Ctrl-C to end access and its owned native processes.

The feature folder contains named parts for pairing/transport, relative gestures, keyboard, preview, setup/controller orchestration, HTTP admission and Mac input/capture. No shared app or protocol files are changed. Compiled native binaries live in a temporary directory, retained rather than deleted.

Focused verification:

```
swiftc -parse-as-library ui/src/bricks/phone-pointer/native.swift -o /tmp/phone-pointer-compile-check
node ui/src/bricks/phone-pointer/check.mjs
```

The check uses a synthetic Mac adapter behind the actual HTTP handler and the built brick in headless Chrome. It checks relative motion, current-pointer taps, keyboard/modifiers, refused input, independent permissions, explicit preview start, pause/return and narrow layouts. It never creates the native adapter, sends desktop input, captures a real screen or starts a microphone. Chrome profiles and screenshots are retained in temporary directories. Native compilation is separate; real TCC permissions, physical phone connectivity and foreground-app acceptance require a person's manual try and are not proven by the synthetic check. No throughput claim is made.
