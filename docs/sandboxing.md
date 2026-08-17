# Code execution and sandboxing

## The short version

WaterLily's current Python runner is useful for trusted notebook-style work, but
it is not safe for unknown or model-generated code. `python3 -I` means a cleaner
Python startup, not a locked room. The intended consumer release should offer a
WebAssembly-based **Safe Python** mode by default and keep direct host Python
behind an explicit **Trusted code** warning.

## What the current runner protects

Every run starts a fresh `python3 -I -u` process. WaterLily sends source
directly to Python without a shell, passes an allowlisted environment without
provider keys, stops the process after ten seconds, and limits captured output
to 256 KiB. `-I` ignores `PYTHON*` environment variables and excludes the
current and user site-package directories from `sys.path`, as described by the
[Python command-line documentation](https://docs.python.org/3/using/cmdline.html#cmdoption-I).

Those controls improve reproducibility and limit accidental resource use. They
do not remove Python's normal authority. Code can still read or change files the
WaterLily user can access, open network connections, start other processes, and
consume CPU or memory until the outer timeout or operating system intervenes.
Think of `-I` as starting with a clean desk; a sandbox is a room whose doors and
windows are actually locked.

## Recommended execution modes

### Safe Python — default

Run a bundled Pyodide interpreter in a dedicated module Web Worker hosted in a
sandboxed renderer/utility process. Workers keep computation off the UI thread
and cannot directly manipulate the DOM; Pyodide documents that architecture in
its [Web Worker guide](https://pyodide.org/en/stable/usage/webworker.html).

For this to be a security boundary rather than just a responsiveness feature,
WaterLily must also:

- package the interpreter and approved wheels locally, with no runtime CDN;
- give the execution renderer no Node integration or WaterLily preload bridge;
- apply a CSP with `connect-src 'none'`, so Python's JavaScript bridge cannot
  turn `fetch` or WebSockets into network access;
- expose only structured input/output messages, copied attachment bytes chosen
  by the user, a bounded in-memory virtual filesystem, and a hard worker kill;
- enforce wall-time, output, memory, and result-size limits outside the worker;
  and
- create a new worker for a fresh kernel or make persistent notebook state an
  explicit visible choice.

This mode protects ordinary host files and makes offline behavior enforceable,
but it has tradeoffs: WebAssembly Python is larger and slower to start, memory
is bounded, and packages requiring unsupported native extensions will not work.

### Trusted host Python — advanced

Keep the current runner for users who deliberately want their installed CPython
and packages. Label it clearly, show the exact code before each first run, and
require per-workspace opt-in. It must never be described as sandboxed.

### Container kernel — optional later

A rootless OCI container can provide normal CPython and more packages with a
read-only root filesystem, a dedicated writable work directory, no network,
dropped capabilities, process/CPU/memory limits, and a seccomp profile. It is a
stronger and more compatible boundary than host Python, but requiring Docker or
Podman is poor default onboarding for non-technical users and still needs prompt
image updates and a container-escape threat model.

## Desktop application boundary

Packaging WaterLily in Electron does not automatically sandbox Python. The
implemented UI renderer independently uses Electron's Chromium process sandbox,
`contextIsolation`, no Node integration, and a private custom protocol. It has
no preload bridge or direct filesystem/process API. Electron documents that
sandboxed renderers cannot directly access the filesystem or spawn processes,
and warns that privileged APIs must be exposed only through narrow, validated
channels:
[process sandboxing](https://www.electronjs.org/docs/latest/tutorial/sandbox)
and
[security checklist](https://www.electronjs.org/docs/latest/tutorial/security).

The desktop build therefore leaves host Python unavailable by default. An
advanced user can launch with `WATERLILY_DESKTOP_ENABLE_HOST_PYTHON=1`, but that
is the same trusted host runner described above, not a stronger sandbox. The
future desktop shell, local service, and Safe Python kernel must remain three
different trust boundaries: compromising a code kernel must not grant the
service's database, credentials, or general host permissions.
