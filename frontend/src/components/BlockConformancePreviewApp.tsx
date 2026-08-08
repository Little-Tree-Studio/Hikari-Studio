import type { BlockConformanceCase } from '../engine-core/blockConformance';
import { Preview } from './Preview';

export function BlockConformancePreviewApp({ testCase }: { testCase: BlockConformanceCase }) {
  return <main className="standalone-preview-app" data-testid="block-conformance-preview" data-case-id={testCase.id}>
    <Preview project={testCase.project} editorIndex={0} standalone conformanceCaseId={testCase.id} />
  </main>;
}
