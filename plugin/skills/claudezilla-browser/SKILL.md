---
name: claudezilla-browser
description: Drive the user's real Firefox through the claudezilla MCP tools — read pages as ref snapshots, act by ref, take vision-sized screenshots, share the tab pool safely. Use when a task needs a real browser, logged-in sites, or the user's open tabs.
---

# Claudezilla browser

Claudezilla drives the user's real Firefox: open tabs, navigate, read pages, click, type and take screenshots (`firefox_*` tools). The browser carries the user's logins, cookies and extensions, so treat it as theirs.

## Workflow

1. **Open your tab.** `firefox_create_window` opens a tab in the shared pool and makes it your current tab. Later calls without `tabId` target your most recent tab.
   ```json
   firefox_create_window {"url": "https://example.com/login"}
   ```
2. **Read before you look.** `firefox_get_accessibility_snapshot` returns a compact text tree, one line per element, with `[ref_N]` handles.
   ```json
   firefox_get_accessibility_snapshot {"filter": "interactive"}
   ```
   ```
   url: https://example.com/login
   title: Sign in
   - textbox "Email" [ref_a1b2_4]
   - button "Sign in" [ref_a1b2_5]
   ```
   Use `filter: "all"` (default) for the full tree, `maxDepth`/`maxNodes` to bound it, and `ref` or `selector` to read only a subtree.
3. **Find by text.** `firefox_find` locates elements by visible text or accessible name and returns `[ref_N]` lines with their landmark or heading context. It is cheaper than a full snapshot on large pages.
   ```json
   firefox_find {"query": "sign in"}
   firefox_find {"query": "^Order #\\d+", "regex": true, "maxResults": 5}
   ```
4. **Act by ref.** Pass `ref` (preferred) or a CSS `selector` to `firefox_click`, `firefox_type`, `firefox_scroll` and `firefox_press_key`.
   ```json
   firefox_type {"ref": "ref_a1b2_4", "text": "user@example.com"}
   firefox_click {"ref": "ref_a1b2_5"}
   firefox_press_key {"ref": "ref_a1b2_4", "key": "Enter"}
   ```
5. **Read long text.** `firefox_get_content` returns the visible text (default 20,000 chars) after a one-line JSON header. When the header says `truncated`, call again with its `nextOffset`.
   ```json
   firefox_get_content {"ref": "ref_a1b2_12"}
   firefox_get_content {"ref": "ref_a1b2_12", "offset": 20000}
   ```
6. **Look only when needed.** Use `firefox_screenshot` when layout or visuals matter (see Screenshots).
   ```json
   firefox_screenshot {}
   ```
7. **Clean up.** Close tabs you no longer need with `firefox_close_tab`.

## Refs and stale-ref recovery

- A ref (for example `ref_a1b2_12`) names one element in the current document. It stays valid until the page navigates or the element is removed.
- Refs are per document: each page load gets a new random prefix, so a ref from a previous page is reported as stale rather than matching another element. Always pass refs exactly as returned.
- A stale ref fails with `<ref> is stale or not found on the current page. Re-read the page to get fresh references.` (for example `ref_a1b2_12 is stale or not found …`). Recover by calling `firefox_get_accessibility_snapshot` or `firefox_find` again and using the new ref. Do not guess a ref number.
- `firefox_get_element` and `firefox_get_content` also accept `ref`. In `firefox_get_page_state`, headings, links, buttons and inputs carry `ref` (images and landmarks do not).

## Screenshots

- The image long edge is capped at `maxEdge` (default 1568 px, range 320–2576). Use 800 for a quick layout check and up to 2576 for small text on high-resolution models.
- `region: {x, y, width, height}` (CSS px, inside the viewport) zooms into one rectangle.
- A text block before the image reports `width`, `height`, `cssScale` and the viewport. Convert image coordinates to CSS px with **CSS px = image px / cssScale**. Example: with `cssScale` 1.0889, a point at image (544, 218) is at CSS (≈500, ≈200).
- For a region, add the region origin: CSS x = `region.x + imageX / cssScale`.
  ```json
  firefox_screenshot {"region": {"x": 0, "y": 0, "width": 400, "height": 300}}
  ```
- `annotate: true` draws numbered badges and returns labels `{index: {ref, role, text}}`; act on the label's `ref`.
- Prefer the snapshot for reading text; screenshots cost far more tokens.

## Multi-agent etiquette

- Tabs you create are yours. Never close or navigate other agents' tabs.
- The pool holds 12 tabs shared by all agents. Close tabs you no longer need. When the pool is full, opening a tab closes your own oldest tab; if you own none, the call fails with `Tab pool full (12/12). You have no tabs to evict.` Then ask with `firefox_request_tab_space` rather than forcing anything.
- Attach to the user's own tabs only when asked: `firefox_list_all_tabs`, then `firefox_attach_tab`; detach with `firefox_detach_tab` when done.
- `firefox_evaluate` stays disabled unless the user enables it in the add-on popup. Do not ask the user to enable it unless no other tool can do the job.

## Harness notes

- **Claude Code:** screenshots arrive as inline images.
- **omp and Mercury Agent:** MCP images are not shown inline. Run the server with `CLAUDEZILLA_SCREENSHOT_FILES=1` (the omp installer target writes it into `~/.omp/agent/mcp.json`; the Mercury target prints it in the config to add); each screenshot taken without an explicit `savePath` is then written to `claudezilla-screenshots/` in the OS temp directory (`os.tmpdir()`, newest 50 kept) and the text block reports `savedPath`. Open `savedPath` with the harness's file reader to see the image.
- **Pi:** the default codemode exposure works; no extra settings are needed. The printed config sets `CLAUDEZILLA_SCREENSHOT_FILES=1`, so screenshots also report a `savedPath`.
- **Hermes Agent:** set `CLAUDEZILLA_SCREENSHOT_FILES: "1"` in the server `env` and add `~/.agents/skills` to `skills.external_dirs` so this skill is found.
- All tools are listed by default. Lazy loading (a single `firefox_activate` gateway) is opt-in via `--tools lazy` or `CLAUDEZILLA_TOOL_MODE=lazy`; in that mode call `firefox_activate` first.

## Troubleshooting

- **Connection errors:** run `firefox_diagnose`. It checks the socket file, the auth token, the connection and the extension version.
- **Firefox not running:** set `CLAUDEZILLA_AUTOSTART_CMD` to a JSON argv array that starts Firefox and returns, e.g. `["open","-a","Firefox"]` (macOS) or `["systemctl","--user","start","claudezilla-browser"]` (the Linux installer's unit). The server runs it when no host answers and waits for it to exit (20 s by default, `CLAUDEZILLA_AUTOSTART_LAUNCH_TIMEOUT_MS`); a command that stays in the foreground, such as `["firefox"]`, is killed and counted as a failed start.
- **Custom socket directory:** `CLAUDEZILLA_IPC_DIR` must be identical for Firefox (native host) and the MCP server, otherwise they cannot find each other.
- **Stale ref:** re-read the page (see above).
- **`TAB_UNAVAILABLE` / tab gone:** call `firefox_get_tabs` or open a new tab with `firefox_create_window`.
