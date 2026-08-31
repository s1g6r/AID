import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-8 p-6 sm:p-10">
      <header className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">AID</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Free browser software that works out how someone who cannot speak or
          use their hands might control a computer, with their head, their eyes,
          or a single facial gesture, and measures how well each one works for
          them.
        </p>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-zinc-500">
          Scaffolding
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Nothing is built yet beyond the sensing layer.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/debug"
            className="w-fit rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
          >
            Open the blendshape debug page
          </Link>
          <Link
            href="/viewer"
            className="w-fit rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            Open a recording in the viewer
          </Link>
        </div>
      </section>

      <section className="flex flex-col gap-2 border-t border-zinc-200 pt-6 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
        <h2 className="font-medium text-zinc-900 dark:text-zinc-100">Privacy</h2>
        <p>
          The camera is processed entirely inside this browser tab. No video, no
          image and no measurement is uploaded anywhere. There is no server and
          no analytics.
        </p>
        <h2 className="mt-3 font-medium text-zinc-900 dark:text-zinc-100">
          What this is not
        </h2>
        <p>
          This is a trial and a bridge aid, meant to be used under the
          supervision of a speech and language professional. It makes no medical
          claims and it should never be anyone&rsquo;s sole means of
          communication.
        </p>
      </section>
    </main>
  );
}
