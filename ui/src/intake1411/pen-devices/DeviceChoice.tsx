import type { InputDevice } from "./contracts";

export function DeviceChoice({ device, onSelect }: { device: InputDevice; onSelect: (device: InputDevice) => void }) {
  return <label>Input device<select value={device} onChange={event => onSelect(event.target.value as InputDevice)}>
    <option value="pointer">Mac mouse or pen</option><option value="touch">Phone / iPad touch surface</option>
  </select></label>;
}
