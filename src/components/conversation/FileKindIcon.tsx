import {
  File,
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Presentation,
} from "lucide-react";
import type { FileKind } from "@/lib/slack/messageFiles";

const ICONS: Record<FileKind, { Icon: typeof File; className: string; label: string }> = {
  image: { Icon: FileImage, className: "bg-sky-500/15 text-sky-600 dark:text-sky-400", label: "Image" },
  audio: { Icon: FileAudio, className: "bg-violet-500/15 text-violet-600 dark:text-violet-400", label: "Audio" },
  video: { Icon: FileVideo, className: "bg-pink-500/15 text-pink-600 dark:text-pink-400", label: "Video" },
  pdf: { Icon: FileText, className: "bg-red-500/15 text-red-600 dark:text-red-400", label: "PDF" },
  word: { Icon: FileText, className: "bg-blue-500/15 text-blue-600 dark:text-blue-400", label: "Document" },
  excel: { Icon: FileSpreadsheet, className: "bg-green-500/15 text-green-600 dark:text-green-400", label: "Spreadsheet" },
  powerpoint: { Icon: Presentation, className: "bg-orange-500/15 text-orange-600 dark:text-orange-400", label: "Presentation" },
  archive: { Icon: FileArchive, className: "bg-amber-500/15 text-amber-600 dark:text-amber-400", label: "Archive" },
  code: { Icon: FileCode, className: "bg-teal-500/15 text-teal-600 dark:text-teal-400", label: "Code" },
  text: { Icon: FileText, className: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-300", label: "Text" },
  other: { Icon: File, className: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-300", label: "File" },
};

export function fileKindLabel(kind: FileKind): string {
  return ICONS[kind].label;
}

/** A coloured icon tile for a file type — PDF, Word, Excel, PowerPoint, archive, code, video… */
export function FileKindIcon({ kind, size = "md" }: { kind: FileKind; size?: "sm" | "md" }) {
  const { Icon, className, label } = ICONS[kind];
  const box = size === "sm" ? "h-8 w-8 rounded-lg" : "h-10 w-10 rounded-xl";
  return (
    <span className={`flex ${box} shrink-0 items-center justify-center ${className}`} title={label} aria-label={label}>
      <Icon size={size === "sm" ? 16 : 20} />
    </span>
  );
}
