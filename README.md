# longhand

I noticed I was getting lazier. Not slower. The agent wrote the code, I
skimmed the diff, it passed, I moved on. A few weeks later I could not
explain parts of my own project.

It compounds. Code you did not write is code you do not really read. Code
you do not read gets messier, because nobody is pushing back on it. Messier
code is harder to read, so you lean on the agent more. Eventually only the
agent can fix the bugs, and the agent gets worse too, because the project it
has to hold in context keeps growing.

Reviewing harder does not fix this. Nobody reads a 400-line diff with real
attention, and everyone clicks approve.

longhand shrinks the unit you approve back down to something that fits in
your head. The agent still does the tedious half: reading, searching,
running the build and the tests, finding the actual cause. It just does not
write into your project. It hands you one change at a time, and you are the
one who puts it in.

The goal: at the end of the day, you can explain everything that went in.

## What it does

`longhand` is a Pi extension that limits writing tools, asks the agent to
hand over one change at a time, and publishes the proposal on a local page
with code that is easy to copy.

## Install

After a release is pushed to GitHub:

```sh
pi install git:github.com/rafaelmarins2003/longhand@v0.1.0
```

To try a local checkout without installing it:

```sh
pi --no-extensions -e /path/to/longhand
```

If this directory is already at `~/.pi/agent/extensions/longhand`, Pi loads
it automatically. Do not also install a Git or npm copy in the same Pi
configuration: both copies would register the same commands and tools.

Pi also supports npm packages. Once `pi-longhand` is published, install it
with `pi install npm:pi-longhand`. Pi supplies the runtime modules used here.

## Use

The mode starts on. Ask the agent for a code change; it investigates and
shows a `localhost` link in the terminal. The page explains the cause, names
the file and location, shows the code to paste, and says how to verify it.
**Copy code** does not change the project. **Makes sense** and **Request a
change** send feedback into the Pi conversation.

| Command | Effect |
| --- | --- |
| `/longhand` | Toggle the mode |
| `/longhand on` / `/longhand off` | Set the mode explicitly |
| `/longhand tools` | Show active and disabled tools |
| `/longhand allow <name>` | Restore one tool for this session |
| `Ctrl+Alt+L` | Toggle the mode |
| `--no-longhand` | Start with the mode off |

The page server binds only to `127.0.0.1`. Links work while the Pi session is
open. Closing Pi removes the pages held in memory. In `--print` mode, the URL
appears but the process exits before the page can be opened; use an
interactive session for this workflow.

`longhand` is a guard against accidental edits, not a shell sandbox.
Commands that execute arbitrary code can still write files, and
`/longhand allow` can restore writing tools.

## Development

Tested with Pi 0.87.0. Run `npm test` to check the command classifier and
local page server. To check extension loading without calling a model, run
`pi --mode rpc --offline --no-session --no-extensions -e ./index.ts` and send
`{"type":"get_entries"}` to standard input.

See [ROADMAP.md](ROADMAP.md) for design decisions and remaining work.
