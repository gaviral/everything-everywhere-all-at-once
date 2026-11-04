import type { ActivityEvent, StatusSource } from "./contracts";
import { SourceSubscription } from "./SourceSubscription";
import type { StatusJoin } from "./StatusJoin";

/** Presentation consumer only; the external feed owner retains its transport and producer. */
export class ActivitySource extends SourceSubscription<ActivityEvent> {
  constructor(source: StatusSource<ActivityEvent> | undefined, join: StatusJoin, changed: () => void, now: () => number) {
    super(source, (event, epoch) => join.acceptActivity(event, epoch), changed, now);
  }
}
