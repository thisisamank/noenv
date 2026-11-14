import { useState } from "react";
import { api, environmentPath } from "../api.ts";
import { findProject, useApp } from "../app-context.ts";
import { Avatar } from "../components/Avatar.tsx";
import { EnvironmentLabel } from "../components/Environment.tsx";
import { ErrorLine, Loading, useToast } from "../components/Feedback.tsx";
import { Icon } from "../components/Icon.tsx";
import { shortRepo, timeAgo } from "../format.ts";
import { href } from "../router.ts";
import type { Project, VersionRow } from "../types.ts";
import { errorMessage, useResource } from "../use-resource.ts";

export function SecretPage({ repo, environment, name }: { repo: string; environment: string; name: string }) {
  const { projects } = useApp();
  const project = findProject(projects.data, repo);
  const history = useResource(
    () => api<{ versions: VersionRow[] }>("GET", `${environmentPath(repo, environment)}/secrets/${name}/versions`).then((body) => body.versions),
    [repo, environment, name],
  );

  if (!project) return projects.loading ? <Loading /> : <ErrorLine message={`No project for ${repo}.`} />;

  return (
    <>
      <div className="crumb">
        <a href={href({ page: "projects" })}>Projects</a>
        <Icon name="chev" />
        <a href={href({ page: "project", repo })}>{shortRepo(repo)}</a>
        <Icon name="chev" />
        <a href={href({ page: "project", repo, environment })}>
          <EnvironmentLabel name={environment} />
        </a>
      </div>
      <div className="head">
        <h1 className="mono">
          {name}
        </h1>
      </div>

      <div className="split history">
        <section>
          <CliValueHint name={name} canWrite={project.role !== "reader"} />
        </section>
        <aside className="card">
          <div className="card-head">History</div>
          {history.loading && !history.data ? <Loading /> : <History project={project} environment={environment} name={name} versions={history.data ?? []} onRestored={history.reload} />}
          <ErrorLine message={history.error} />
        </aside>
      </div>
    </>
  );
}

function CliValueHint({ name, canWrite }: { name: string; canWrite: boolean }) {
  return (
    <div className="panel cli-hint">
      <p className="muted">
        {canWrite
          ? "Set a new value from your terminal. The CLI signs each version with the environment key, so a value written without that key never loads."
          : "Readers can see the history. An editor sets new values from the terminal."}
      </p>
      {canWrite && <pre className="mono">noenv secret set {name}</pre>}
    </div>
  );
}

function History({
  project,
  environment,
  name,
  versions,
  onRestored,
}: {
  project: Project;
  environment: string;
  name: string;
  versions: VersionRow[];
  onRestored: () => void;
}) {
  const notify = useToast();
  const canWrite = project.role !== "reader";

  async function restore(version: number) {
    try {
      const restored = await api<{ version: number }>("POST", `${environmentPath(project.repo, environment)}/secrets/${name}/rollback`, { version });
      notify(`Restored v${version} as v${restored.version}`);
      onRestored();
    } catch (error) {
      notify(errorMessage(error), "bad");
    }
  }

  return (
    <ul className="timeline">
      {versions.map((version, index) => (
        <li key={version.version} className={index === 0 ? "current" : ""}>
          <span className="node" />
          <div className="cell">
            <span className="version">v{version.version}</span>
            <Avatar email={version.author} />
            <span className="muted">{timeAgo(version.createdAt)}</span>
            {version.restoredFrom && <span className="pill">from v{version.restoredFrom}</span>}
          </div>
          {index === 0 ? (
            <span className="pill">Current</span>
          ) : (
            canWrite && (
              <button className="btn sm" onClick={() => restore(version.version)}>
                <Icon name="restore" />
                Restore
              </button>
            )
          )}
        </li>
      ))}
    </ul>
  );
}
