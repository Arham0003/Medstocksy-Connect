# Medstocksy Connect — AI QA Testing Context

## Project Overview

Medstocksy Connect is a Next.js-based CRM application.

The purpose of this testing session is to perform:
- exploratory testing
- functional testing
- UI validation
- workflow validation
- API validation
- CRUD testing
- responsiveness testing
- console/API monitoring
- bug discovery

The AI agent must behave like:
- a senior QA engineer
- a stateful exploratory tester
- a workflow validator
- a production bug hunter

The goal is NOT shallow click automation.

The goal is to uncover:
- broken workflows
- stale UI state
- hydration issues
- API failures
- inconsistent CRUD behavior
- routing problems
- validation issues
- UX issues
- frontend/backend mismatches

---

# Tech Stack Context

## Frontend
- Next.js application
- Client-side routing
- Dynamic rendering
- Possible SSR/CSR/App Router usage

## Backend
- API-driven CRM workflows
- Dynamic API interactions
- CRUD-heavy application

## Testing Framework
- Native Python Playwright
- sync_playwright()
- Chromium headless mode

---

# Core Testing Principles

## Always Wait for Hydration

This is a dynamic Next.js application.

Before interacting:

```python
page.wait_for_load_state("networkidle")