import { mountReactIsland } from "../../components/react-island";
import benchmark from "../military-mode-benchmark.json";
import { type BenchmarkRowView, getBenchmarkView } from "./helpers";

interface BenchmarkRowProps {
  row: BenchmarkRowView;
}
const BenchmarkRow = ({ row }: BenchmarkRowProps) => (
  <tr>
    {row.cells.map((cell, index) => <td key={index}>{cell}</td>)}
  </tr>
);

interface MilitaryBenchmarkPanelProps {
  caption: string;
  columns: readonly string[];
  notice: string;
  rows: readonly BenchmarkRowView[];
}
/** Archived observations only: this view never changes military behavior or performs a benchmark. */
export const MilitaryBenchmarkPanel = ({ caption, columns, notice, rows }: MilitaryBenchmarkPanelProps) => (
  <>
    <p>{notice}</p>
    <div
      aria-label="Historical benchmark table; scroll horizontally for all columns"
      className="military-benchmark-window__table"
      role="region"
      tabIndex={0}
    >
      <table>
        <caption>{caption}</caption>
        <thead>
          <tr>
            {columns.map(column => <th key={column} scope="col">{column}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map(row => <BenchmarkRow key={row.key} row={row} />)}
        </tbody>
      </table>
    </div>
  </>
);

export const mountMilitaryBenchmarkPanel = (container: HTMLElement) =>
  mountReactIsland(container, <MilitaryBenchmarkPanel {...getBenchmarkView(benchmark)} />);
