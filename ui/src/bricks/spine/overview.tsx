/** The phone keeps every destination readable while the spatial map remains behind it. */
export function PhoneOverview({ topics, read }: {
  topics: readonly { id: string; title: string; parent?: string; count: number }[];
  read(id: string): void;
}) {
  return <nav className="spine-overview-index" aria-label="Topics in map overview">
    <div className="spine-overview-heading"><strong>Topics on this map</strong><span>Swipe to browse</span></div>
    <div className="spine-overview-scroll">
      {topics.map(topic => <button key={topic.id} type="button" data-overview-thread={topic.id}
        aria-label={`Read ${topic.parent ? 'tangent' : 'topic'}: ${topic.title}`} onClick={() => read(topic.id)}>
        <span>{topic.title}</span><small>{topic.parent ? `Tangent · ${topic.parent}` : `${topic.count} ${topic.count === 1 ? 'thought' : 'thoughts'}`}</small>
      </button>)}
    </div>
  </nav>;
}
