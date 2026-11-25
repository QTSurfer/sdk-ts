# Signal channels

A signal channel delivers publisher notices about instruments to subscribed live runs as source
attachments. The generated `@qtsurfer/api-client` exposes these calls, including code redemption,
offers, run subscriptions, notices, deliveries, and public channel listings. Use a key with the
applicable `signals:read` or `signals:write` grant for authenticated calls.

See the [Signal channels API guide](https://www.qtsurfer.com/docs/developers/api/signals) for
publisher and subscriber workflows. Keep webhook URLs and single-use offer codes out of logs.
When polling subscription deliveries, a delayed delivery omits its `source` and `data` until
it is due. Follow the returned pagination cursor for another page.

To observe a delivered source's live state, use the SDK's [live run methods](live.md).

```ts
import { authenticate } from '@qtsurfer/sdk';

const qts = await authenticate();
const run = await qts.getLiveRun(runId);
console.log(run.attachments?.map(({ attachmentId, state }) => ({ attachmentId, state })));
```

A delivery attaches a source. [Live signal history](live.md) reads events emitted by the strategy.
