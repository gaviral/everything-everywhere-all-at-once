import type { Connection, SourceObserver, StatusSource } from "./contracts";

/** Scoped preview fixture. Never connects to a service or launches work. */
export class SyntheticSource<T> implements StatusSource<T> {
  private observers = new Set<SourceObserver<T>>();
  private connectionState: Connection = "connected";
  subscribe(observer: SourceObserver<T>) {
    this.observers.add(observer);
    observer.connection(this.connectionState);
    return () => { this.observers.delete(observer); };
  }
  emit(event: T) { for (const observer of this.observers) observer.event(event); }
  connection(state: Connection) {
    this.connectionState = state;
    for (const observer of this.observers) observer.connection(state);
  }
  get count() { return this.observers.size; }
}
