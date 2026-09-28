import { runRegexJob, type RegexJob } from './job';

export interface RegexWorkerRequest extends RegexJob {
  id: number;
}

self.onmessage = (event: MessageEvent<RegexWorkerRequest>) => {
  const { id, ...job } = event.data;
  self.postMessage({ id, result: runRegexJob(job) });
};
