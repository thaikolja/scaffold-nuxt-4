# Scaffold Nuxt 4

[![NPM Version](https://img.shields.io/npm/v/@thaikolja/scaffold-nuxt-4)](https://www.npmjs.com/package/@thaikolja/scaffold-nuxt-4) [![Node.js Version](https://img.shields.io/node/v/@thaikolja/scaffold-nuxt-4.svg)](https://nodejs.org/en/) [![License](https://img.shields.io/npm/l/@thaikolja/scaffold-nuxt-4)](https://gitlab.com/thaikolja/scaffold-nuxt-4/-/blob/main/LICENSE)

A deterministic scaffolder for **Nuxt 4** that adds template files intelligently without overwriting existing ones. Supports built-in, Git, or local templates and automatically detects features like @nuxt/content and Tailwind CSS, with options to customize via flags.

## Overview

This script is designed to make it easy to start a new Nuxt 4 project with a standard set of template files. It is "additive", which means it will only add files that don't already exist in your project. This makes it safe to run multiple times. The script can detect if you are using `@nuxt/content` or `tailwindcss` and will automatically include the relevant template files. You can also override this behavior with command-line flags.

## Features

-   **Idempotent:** Safely run the script multiple times without overwriting existing files.
-   **Feature Detection:** Automatically detects `@nuxt/content` and `tailwindcss`.
-   **Flexible Template Sources:** Use the built-in template, a remote Git repository, or a local directory.
-   **Dry Run Mode:** Preview the changes without actually modifying any files.
-   **JSON Output:** Get the results in JSON format for use in other scripts.
-   **Colorized Output:** Easy-to-read color-coded output in the terminal.

## Usage

To use the script, run the following command in your Nuxt 4 project's root directory:

```bash
npx @thaikolja/scaffold-nuxt-4 [flags] [targetPath]
```

If no `targetPath` is provided, the current working directory will be used.

## Examples

**Scaffold the current directory:**

```bash
npx @thaikolja/scaffold-nuxt-4
```

**Scaffold a specific directory:**

```bash
npx @thaikolja/scaffold-nuxt-4 ./my-nuxt-project
```

**Scaffold with Tailwind CSS files, even if not detected:**

```bash
npx @thaikolja/scaffold-nuxt-4 --with-tailwind
```

**Preview the files that would be added without actually copying them:**

```bash
npx @thaikolja/scaffold-nuxt-4 --dry-run
```

**Use a custom template from a Git repository:**

```bash
npx @thaikolja/scaffold-nuxt-4 --template-url=https://github.com/user/template.git --template-ref=develop
```

## Flags

| Flag | Alias | Description |
| :--- | :--- | :--- |
| `--all` | | Includes all files from the template, ignoring automatic feature detection. |
| `--with-content` | | Forces the inclusion of files related to @nuxt/content. |
| `--without-content` | | Forces the exclusion of files related to @nuxt/content. |
| `--with-tailwind` | | Forces the inclusion of files related to Tailwind CSS. |
| `--without-tailwind`| | Forces the exclusion of files related to Tailwind CSS. |
| `--clean` | `-c` | Excludes INFO.md files from being copied. |
| `--dry-run` | | Simulates the scaffolding process without making any changes to the filesystem. |
| `--list` | | Lists all files in the template and their classification (add, skip, exclude). |
| `--json` | | Outputs the results of the scaffolding process in JSON format. |
| `--debug` | | Enables debug mode for more verbose output. |
| `--no-color` | | Disables color-coded output. |
| `--include-docs` | | Includes documentation files (e.g., README.md, LICENSE) in the copy process. |
| `--template-url` | | Specifies the URL of a Git repository or the path to a local directory to use as the template source. |
| `--template-ref` | | Specifies the branch, tag, or commit to use when cloning a Git repository. |
| `--template-dir` | | Specifies the subdirectory within the template source that contains the files to be copied. |
| `--version` | `-v` | Prints the version of the script. |
| `--help` | `-h` | Displays the help message. |

## Template Sources

The script can use templates from three types of sources, in the following order of priority:

1.  **Embedded:** The script comes with a built-in template. This is the default and is used when no other source is specified.
2.  **Git Repository:** You can specify a remote Git repository using the `--template-url` and `--template-ref` flags.
3.  **Local Directory:** You can specify a local directory using the `--template-url` flag.

## Environment Variables

-   `SCAFFOLD_REPO_URL`: Overrides the default template repository URL.
-   `SCAFFOLD_REPO_REF`: Overrides the default template repository branch/tag/commit.
-   `SCAFFOLD_FAST=1`: Uses a faster, optimized git clone method.
-   `NO_COLOR=1`: Disables colorized output.

## Contributing

Contributions are welcome! Please open an issue or submit a merge request on [GitLab](https://gitlab.com/thaikolja/scaffold-nuxt-4).

## License

[MIT](https://gitlab.com/thaikolja/scaffold-nuxt-4/-/blob/main/LICENSE)
