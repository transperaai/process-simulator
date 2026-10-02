import type { ReactNode } from "react";
import { ShellHeader } from "./shell-header";

/**
 * The frame of every page inside the shell but the map (issue #98): the top bar with the sidebar toggle, then a
 * header like the prototype's (small group name, title, one plain sentence, actions on the right) and the content.
 * `eyebrow` is the sidebar group the page lives in ("Improve", "Company").
 */
export function Page({
  title,
  eyebrow,
  description,
  actions,
  width = "max-w-5xl",
  hideHeader = false,
  children,
}: {
  title: string;
  eyebrow?: string;
  description?: ReactNode;
  actions?: ReactNode;
  width?: "max-w-3xl" | "max-w-5xl" | "max-w-6xl";
  /** The content draws its own header (the Issue page's has breadcrumbs, a rating and the buttons). */
  hideHeader?: boolean;
  children: ReactNode;
}) {
  return (
    <div>
      <ShellHeader title={title} />
      <div className={`mx-auto flex w-full min-w-0 flex-col gap-6 px-4 pb-12 pt-6 sm:px-6 ${width}`}>
        {!hideHeader && <PageHeader title={title} eyebrow={eyebrow} description={description} actions={actions} />}
        {children}
      </div>
    </div>
  );
}

export function PageHeader({ title, eyebrow, description, actions }: { title: string; eyebrow?: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
      <div className="flex min-w-0 max-w-prose flex-col gap-1">
        {eyebrow && <span className="text-2xs font-semibold tracking-wider text-muted-foreground uppercase">{eyebrow}</span>}
        <h1 className="font-heading text-2xl leading-tight font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
