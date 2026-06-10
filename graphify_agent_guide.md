# Graphify Navigation & Development Guide for AI Agents

> [!IMPORTANT]
> This codebase uses a **Graphify Knowledge Graph** to map files, dependencies, AST structures, and component relationships. 
> To minimize token consumption and reduce tool-execution loops, you **MUST** use the graphify tools and output files to locate code and plan your changes.

---

## 1. High-Level Architecture Overview
Before reading source code files, read the pre-computed graph report:
* **File Path:** [GRAPH_REPORT.md](file:///e:/Pivot%20New%20Work/Medstocksy-Connect%2018-05-26/graphify-out/GRAPH_REPORT.md)
* **What it contains:** Total file count, core abstractions ("God Nodes" like `useT` or `useActivePharmacy`), file communities/clusters (which files are grouped together by feature), and imports/dependencies.
* **Instruction:** Read this file first to understand the modular boundaries and structure of the app.

---

## 2. Locating Code and Relationships (Dynamic Queries)
Instead of searching through files with recursive grepping or reading large files line-by-line, use the MCP tools or run the following CLI commands to fetch narrow, precise subgraphs from `graphify-out/graph.json`:

* **To find where a feature, table, or concept is located:**
  ```powershell
  graphify query "<your question or description here>"
  ```
  *(MCP equivalent: `query_graph`)*

* **To explain a specific node, hook, component, or file:**
  ```powershell
  graphify explain "<node_name_or_file_basename>"
  ```
  *(MCP equivalent: `get_node`)*

* **To find the dependency or import path between two components (A and B):**
  ```powershell
  graphify path "<source_component>" "<target_component>"
  ```
  *(MCP equivalent: `shortest_path`)*

---

## 3. Mandatory Development Rules
1. **Prioritize Graph Queries:** Always query the graph (`graphify query` / `graphify explain`) before performing heavy `grep_search` or opening multiple unknown files.
2. **Navigate Wiki:** If `graphify-out/wiki/index.md` exists, navigate it instead of reading raw files.
3. **Keep the Graph Fresh:** After you create, delete, or modify code files during a development session, you **must** update the knowledge graph so future searches remain accurate. Run:
   ```powershell
   python -m graphify update .
   ```
   *(Or `graphify update .` if globally configured. This updates `graphify-out/graph.json` and `graphify-out/GRAPH_REPORT.md` using a fast, local AST scan with zero API cost).*
