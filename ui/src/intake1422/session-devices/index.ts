import { SessionDevices } from "./session-devices";
export const sessionDevicesFeature = Object.freeze({
  id: "intake1422-session-devices", defaultEnabled: false,
  label: "Shared session devices", create: (...args: ConstructorParameters<typeof SessionDevices>) => new SessionDevices(...args),
  prerequisites: ["Host room transport registration", "One shared atomic listener authority", "Trusted local confirmation and release policy"],
});
export { DevicePanel } from "./device-panel";
export { SessionDevices } from "./session-devices";
export { deviceIdentity } from "./device-identity";
export { SessionSync } from "./session-sync";
export type * from "./contracts";
