import type { InputDevice, InputSnapshot } from "./contracts";

export function captureReadiness(snapshot: InputSnapshot, device: InputDevice, selected: string, on: boolean) {
  const destination = snapshot.sessions.find(session => session.id === selected);
  if (!on) return { ready: false, message: "Drawing stopped." };
  if (!destination) return { ready: false, message: "Choose a destination session to draw." };
  if (!destination.connected) return { ready: false, message: `${destination.name} disconnected. Drawing paused.` };
  if (device === "touch" && !snapshot.touchAvailable) return { ready: false, message: "Touch adapter unavailable. Drawing paused." };
  return { ready: true, message: `Drawing to ${destination.name}.` };
}
