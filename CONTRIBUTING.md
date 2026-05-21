# Contributing to Kortex

Thank you for your interest in contributing to Kortex.

This document explains how to report issues, propose changes, and submit pull requests in a way that keeps the project maintainable.

## Ways to Contribute

You can contribute by:

- reporting bugs
- proposing product or UX improvements
- improving documentation
- fixing backend or frontend issues
- improving RAG quality, model integration, or deployment workflows

## Before You Start

Please check the following before opening a pull request:

1. Search existing issues and pull requests to avoid duplicate work.
2. For non-trivial changes, open an issue first to align on direction.
3. Keep changes scoped. Avoid mixing unrelated refactors into the same PR.

## Development Setup

```powershell
python -m venv .venv
.\.venv\Scripts\python -m pip install -r backend\requirements.txt
npm.cmd install
```

Start the development environment:

```powershell
npm.cmd run dev
```

Useful commands:

```powershell
npm.cmd run build:frontend
python -m py_compile backend\app\main.py backend\app\database.py backend\app\rag.py backend\app\security.py
```

## Branch and Commit Guidelines

- Use short, descriptive branch names.
- Keep commit messages clear and direct.
- Recommended commit style:
  - `feat: add project sharing filter`
  - `fix: handle invite preview errors`
  - `docs: update deployment guide`

## Pull Request Guidelines

Please make sure your pull request:

- explains what changed
- explains why the change is needed
- includes screenshots for visible UI changes when relevant
- mentions any migration, deployment, or compatibility impact
- stays focused on one logical change

## Code Style

### General

- Prefer small, understandable changes over broad rewrites.
- Reuse existing patterns already present in the project.
- Avoid unrelated formatting churn.

### Frontend

- Keep UI clean, responsive, and product-oriented.
- Avoid overflow and layout instability.
- Prefer simple, readable interaction patterns.

### Backend

- Keep API behavior explicit and predictable.
- Preserve backward compatibility when possible.
- Validate permission-related changes carefully.

## Documentation

If your change affects product behavior, deployment, configuration, or contributor workflows, update the relevant documentation:

- `README.md`
- `README.en.md`
- `docs/`
- `CHANGELOG.md`

## Reporting Bugs

When opening a bug report, please include:

- environment details
- steps to reproduce
- expected behavior
- actual behavior
- screenshots or logs if available

## Feature Requests

A good feature request usually includes:

- the user problem
- why the current behavior is insufficient
- the expected outcome
- any constraints or deployment considerations

## Community and Contact

For discussion or collaboration:

- QQ: `1062147677`

Thank you for helping improve Kortex.
