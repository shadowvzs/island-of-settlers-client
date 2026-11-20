import { SettlementIcon } from "../../components/settlement-icon";
import { getWorkerPortraitSource } from "./workforce-helpers";

interface WorkerPortraitProps {
  job: string;
}
/** React twin of the DOM worker portrait: the job's render, the people icon when none exists. */
export const WorkerPortrait = ({ job }: WorkerPortraitProps) => {
  const source = getWorkerPortraitSource(job);
  if (!source) return <SettlementIcon name="people" />;
  return <img alt="" draggable={false} loading="eager" src={source} />;
};
