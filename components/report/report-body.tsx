import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Canonical Markdown report renderer — the single place the `prose` class
// string lives (previously duplicated near-identically in 2 components with
// a violet/sky accent inconsistency between them). Uses the `report` named
// typography variant (tailwind.config.ts) for equity-research-style section
// dividers on every `## N. Title` heading the AI emits.
export default function ReportBody({ markdown }: { markdown: string }) {
  return (
    <div className="prose prose-invert prose-report prose-sm max-w-none print:text-slate-900">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
    </div>
  );
}
