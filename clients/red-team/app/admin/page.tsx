"use client";

import { Suspense, useEffect, useState, useRef, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import Script from "next/script";
import { useAuth } from "@/lib/auth";
import { apiFetch } from "@/lib/api";
import { SvgSprite, Icon } from "@/components/ui/Icon";
import { LoginOverlay } from "@/components/layout/LoginOverlay";
import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { DashboardView } from "@/components/admin/DashboardView";
import { DataTable } from "@/components/admin/DataTable";
import { RowForm } from "@/components/admin/RowForm";
import { getFormComponent } from "@/components/admin/forms";
import { Breadcrumb } from "@/components/admin/Breadcrumb";
import type { NavEntry } from "@/components/admin/Breadcrumb";
import { ChildTabs } from "@/components/admin/ChildTabs";
import type {
  AdminHierarchy,
  TableSchema,
  TableInfo,
  ChildDef,
} from "@/lib/types";
import "@/styles/admin.css";

const API = "/admin/api";
const LIMIT = 50;

// Toast element helper (uses the CSS toast styles from admin.css)
function showToast(msg: string, ok: boolean) {
  const el = document.createElement("div");
  el.className = "toast " + (ok ? "ok" : "err");
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

function AdminPageInner() {
  const { user, loading: authLoading } = useAuth();
  const searchParams = useSearchParams();
  const isEmbed = searchParams.get("embed") === "1";
  const embedTable = searchParams.get("table");

  // Default sort column per table
  const DEFAULT_SORT: Record<string, { col: string; dir: "ASC" | "DESC" }> = {
    curriculum_facts: { col: "order", dir: "ASC" },
    curriculum_capsules: { col: "capsule_order", dir: "ASC" },
    curriculum_themes: { col: "theme_order", dir: "ASC" },
    subject_curriculum: { col: "phase", dir: "ASC" },
    learning_sessions: { col: "start_time", dir: "DESC" },
  };

  // Core state
  const [hier, setHier] = useState<AdminHierarchy | null>(null);
  const [tableCounts, setTableCounts] = useState<Record<string, number>>({});
  const [navStack, setNavStack] = useState<NavEntry[]>([]);
  const [schema, setSchema] = useState<TableSchema | null>(null);
  const [rows, setRows] = useState<Record<string, any>[]>([]);
  const [fkLabels, setFkLabels] = useState<Record<string, Record<string, string>>>({});
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [orderBy, setOrderBy] = useState<string | null>(null);
  const [orderDir, setOrderDir] = useState<"ASC" | "DESC">("ASC");
  const [searchVal, setSearchVal] = useState("");
  const [tableLoading, setTableLoading] = useState(false);

  // Dashboard
  const [showDashboard, setShowDashboard] = useState(true);
  const [dashStats, setDashStats] = useState<any>(null);
  const [dashLoading, setDashLoading] = useState(false);
  const dashLoadedRef = useRef(0);

  // Form modal
  const [formOpen, setFormOpen] = useState(false);
  const [editingPk, setEditingPk] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Record<string, any> | null>(null);
  const [formSaving, setFormSaving] = useState(false);

  // Confirm delete
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deletePk, setDeletePk] = useState<string | null>(null);

  // Sidebar mobile
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Search debounce
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- Helpers ---
  const curNav = useCallback((): NavEntry | null => {
    return navStack.length ? navStack[navStack.length - 1] : null;
  }, [navStack]);

  const curTable = useCallback((): string | null => {
    const n = curNav();
    return n ? n.table : null;
  }, [curNav]);

  const tableLabel = useCallback(
    (t: string): string => {
      if (hier && hier.labels[t]) return hier.labels[t];
      return t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    },
    [hier]
  );

  const tableLabelCol = useCallback(
    (t: string): string => (hier && hier.label_col[t]) || "id",
    [hier]
  );

  const tableChildren = useCallback(
    (t: string): ChildDef[] => (hier && hier.children[t]) || [],
    [hier]
  );

  const tablePk = useCallback(
    (t: string): string => (hier && hier.pk_map[t]) || "id",
    [hier]
  );

  const getRowLabel = useCallback(
    (row: Record<string, any>, table: string): string => {
      const col = tableLabelCol(table);
      const val = row[col];
      if (val == null)
        return String(row[tablePk(table)] || "").substring(0, 12);
      const s = String(val);
      return s.length > 40 ? s.substring(0, 40) + "..." : s;
    },
    [tableLabelCol, tablePk]
  );

  // Active sidebar table (root of current nav or dashboard)
  const activeSidebarTable = showDashboard
    ? "__dashboard__"
    : navStack.length
      ? navStack[0].table
      : null;

  // --- Data loading ---
  const refreshRows = useCallback(
    async (
      stack: NavEntry[],
      currentSchema: TableSchema | null,
      currentOffset: number,
      currentOrderBy: string | null,
      currentOrderDir: "ASC" | "DESC",
      currentSearch: string
    ) => {
      const nav = stack.length ? stack[stack.length - 1] : null;
      if (!nav) return;
      let url =
        API +
        "/tables/" +
        encodeURIComponent(nav.table) +
        "/rows?limit=" +
        LIMIT +
        "&offset=" +
        currentOffset;
      if (currentOrderBy)
        url +=
          "&order_by=" +
          encodeURIComponent(currentOrderBy) +
          "&order_dir=" +
          currentOrderDir;
      if (currentSearch)
        url += "&search=" + encodeURIComponent(currentSearch);
      if (nav.filterCol && nav.filterVal)
        url +=
          "&filter_col=" +
          encodeURIComponent(nav.filterCol) +
          "&filter_val=" +
          encodeURIComponent(nav.filterVal);
      try {
        const data = await apiFetch<any>(url);
        setRows(data.rows);
        setTotal(data.total);
        setFkLabels(data.fk_labels || {});
      } catch (e: any) {
        if (e.message !== "auth") showToast("Failed to load rows", false);
      }
    },
    []
  );

  const loadLevel = useCallback(
    async (stack: NavEntry[]) => {
      const nav = stack.length ? stack[stack.length - 1] : null;
      if (!nav) return;
      setTableLoading(true);
      try {
        const newSchema = await apiFetch<TableSchema>(
          API + "/tables/" + encodeURIComponent(nav.table) + "/schema"
        );
        setSchema(newSchema);
        const ds = DEFAULT_SORT[newSchema.table];
        const sortCol = ds?.col || null;
        const sortDir = ds?.dir || "ASC";
        if (sortCol) { setOrderBy(sortCol); setOrderDir(sortDir); }
        await refreshRows(stack, newSchema, 0, sortCol, sortDir, "");
      } catch (e: any) {
        if (e.message !== "auth") showToast("Failed to load data", false);
      } finally {
        setTableLoading(false);
      }
    },
    [refreshRows]
  );

  // --- Navigation ---
  const navigateToRoot = useCallback(
    (table: string) => {
      setShowDashboard(false);
      const newStack: NavEntry[] = [
        { table, filterCol: null, filterVal: null, rowLabel: tableLabel(table) },
      ];
      setNavStack(newStack);
      setOffset(0);
      const ds = DEFAULT_SORT[table];
      setOrderBy(ds?.col || null);
      setOrderDir(ds?.dir || "ASC");
      setSearchVal("");
      loadLevel(newStack);
    },
    [tableLabel, loadLevel]
  );

  const drillDown = useCallback(
    (childDef: ChildDef, parentPkVal: string, rowLabel: string) => {
      setNavStack((prev) => {
        const newStack = [
          ...prev,
          {
            table: childDef.table,
            filterCol: childDef.fk,
            filterVal: parentPkVal,
            rowLabel,
          },
        ];
        setOffset(0);
        const ds = DEFAULT_SORT[childDef.table];
        setOrderBy(ds?.col || null);
        setOrderDir(ds?.dir || "ASC");
        setSearchVal("");
        loadLevel(newStack);
        return newStack;
      });
    },
    [loadLevel]
  );

  const navigateToLevel = useCallback(
    (idx: number) => {
      setNavStack((prev) => {
        const newStack = prev.slice(0, idx + 1);
        setOffset(0);
        setOrderBy(null);
        setOrderDir("ASC");
        setSearchVal("");
        loadLevel(newStack);
        return newStack;
      });
    },
    [loadLevel]
  );

  const switchChildTab = useCallback(
    (childDef: ChildDef) => {
      setNavStack((prev) => {
        const last = prev[prev.length - 1];
        const newStack = [
          ...prev.slice(0, -1),
          {
            table: childDef.table,
            filterCol: childDef.fk,
            filterVal: last.filterVal,
            rowLabel: last.rowLabel,
          },
        ];
        setOffset(0);
        setOrderBy(null);
        setOrderDir("ASC");
        setSearchVal("");
        loadLevel(newStack);
        return newStack;
      });
    },
    [loadLevel]
  );

  // Dashboard drill: from dashboard into a CRUD table with optional parent filter
  const dashDrill = useCallback(
    (
      table: string,
      filterCol: string | null,
      filterVal: string | null,
      label: string | null
    ) => {
      if (!hier) return;
      setShowDashboard(false);

      // Find the root table by walking hierarchy
      let rootTable: string | null = null;
      hier.root_groups.forEach((g) => {
        function search(t: string): boolean {
          if (t === table) {
            rootTable = g.tables[0];
            return true;
          }
          const ch = hier.children[t];
          if (ch) {
            for (let i = 0; i < ch.length; i++) {
              if (search(ch[i].table)) return true;
            }
          }
          return false;
        }
        g.tables.forEach(search);
      });
      if (!rootTable) rootTable = table;

      let newStack: NavEntry[];
      if (filterCol && filterVal) {
        newStack = [
          {
            table: rootTable,
            filterCol: null,
            filterVal: null,
            rowLabel: tableLabel(rootTable),
          },
        ];
        if (rootTable !== table) {
          newStack.push({
            table,
            filterCol,
            filterVal,
            rowLabel: label || filterVal.substring(0, 12),
          });
        }
      } else {
        newStack = [
          {
            table: rootTable,
            filterCol: null,
            filterVal: null,
            rowLabel: tableLabel(rootTable),
          },
        ];
        if (rootTable !== table) {
          newStack = [
            {
              table: rootTable,
              filterCol: null,
              filterVal: null,
              rowLabel: tableLabel(rootTable),
            },
            {
              table,
              filterCol: null,
              filterVal: null,
              rowLabel: tableLabel(table),
            },
          ];
        }
      }

      setNavStack(newStack);
      setOffset(0);
      setOrderBy(null);
      setOrderDir("ASC");
      setSearchVal("");
      loadLevel(newStack);
    },
    [hier, tableLabel, loadLevel]
  );

  // --- Dashboard loading ---
  const loadDashboard = useCallback(async () => {
    setDashLoading(true);
    try {
      const data = await apiFetch<any>(API + "/stats");
      dashLoadedRef.current = Date.now();
      setDashStats(data);
    } catch (e: any) {
      if (e.message !== "auth") showToast("Failed to load dashboard data", false);
    } finally {
      setDashLoading(false);
    }
  }, []);

  const handleShowDashboard = useCallback(() => {
    setShowDashboard(true);
    setNavStack([]);
    // Reload if stale (>30s) or never loaded
    if (Date.now() - dashLoadedRef.current > 30000) {
      loadDashboard();
    }
  }, [loadDashboard]);

  // --- Sidebar select ---
  const handleSidebarSelect = useCallback(
    (table: string) => {
      setSidebarOpen(false);
      if (table === "__dashboard__") {
        handleShowDashboard();
      } else {
        navigateToRoot(table);
      }
    },
    [handleShowDashboard, navigateToRoot]
  );

  // --- Sort ---
  const handleSort = useCallback(
    (col: string) => {
      let newOrderBy = orderBy;
      let newOrderDir = orderDir;
      if (orderBy === col) {
        newOrderDir = orderDir === "ASC" ? "DESC" : "ASC";
      } else {
        newOrderBy = col;
        newOrderDir = "ASC";
      }
      setOrderBy(newOrderBy);
      setOrderDir(newOrderDir);
      setOffset(0);
      refreshRows(navStack, schema, 0, newOrderBy, newOrderDir, searchVal);
    },
    [orderBy, orderDir, navStack, schema, searchVal, refreshRows]
  );

  // --- Search ---
  const handleSearchChange = useCallback(
    (val: string) => {
      setSearchVal(val);
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
      searchTimerRef.current = setTimeout(() => {
        setOffset(0);
        refreshRows(navStack, schema, 0, orderBy, orderDir, val);
      }, 300);
    },
    [navStack, schema, orderBy, orderDir, refreshRows]
  );

  // --- Pagination ---
  const handlePrev = useCallback(() => {
    const newOffset = Math.max(0, offset - LIMIT);
    setOffset(newOffset);
    refreshRows(navStack, schema, newOffset, orderBy, orderDir, searchVal);
  }, [offset, navStack, schema, orderBy, orderDir, searchVal, refreshRows]);

  const handleNext = useCallback(() => {
    const newOffset = offset + LIMIT;
    setOffset(newOffset);
    refreshRows(navStack, schema, newOffset, orderBy, orderDir, searchVal);
  }, [offset, navStack, schema, orderBy, orderDir, searchVal, refreshRows]);

  // --- Refresh ---
  const handleRefresh = useCallback(() => {
    refreshRows(navStack, schema, offset, orderBy, orderDir, searchVal);
  }, [navStack, schema, offset, orderBy, orderDir, searchVal, refreshRows]);

  // --- Drill down from row click ---
  const handleDrillDown = useCallback(
    (row: Record<string, any>) => {
      const table = curTable();
      if (!table) return;
      const children = tableChildren(table);
      if (children.length === 0) return;
      const pk = schema?.pk || "id";
      const pkVal = String(row[pk]);
      const label = getRowLabel(row, table);
      drillDown(children[0], pkVal, label);
    },
    [curTable, tableChildren, schema, getRowLabel, drillDown]
  );

  // --- CRUD: Create ---
  const handleCreate = useCallback(() => {
    setEditingPk(null);
    setEditValues(null);
    setFormOpen(true);
  }, []);

  // --- CRUD: Edit ---
  const handleEdit = useCallback(
    async (pkVal: string) => {
      const table = curTable();
      if (!table) return;
      setEditingPk(pkVal);
      setEditValues(null);
      setFormOpen(true);
      try {
        const row = await apiFetch<any>(
          API +
            "/tables/" +
            encodeURIComponent(table) +
            "/rows/" +
            encodeURIComponent(pkVal)
        );
        setEditValues(row);
      } catch (e: any) {
        if (e.message !== "auth") {
          showToast("Failed to load row", false);
          setFormOpen(false);
        }
      }
    },
    [curTable]
  );

  // --- CRUD: Save ---
  const handleSave = useCallback(
    async (data: Record<string, any>) => {
      const table = curTable();
      if (!table) return;
      setFormSaving(true);
      try {
        if (editingPk) {
          await apiFetch(
            API +
              "/tables/" +
              encodeURIComponent(table) +
              "/rows/" +
              encodeURIComponent(editingPk),
            {
              method: "PUT",
              body: JSON.stringify(data),
            }
          );
          showToast("Updated", true);
        } else {
          await apiFetch(
            API + "/tables/" + encodeURIComponent(table) + "/rows",
            {
              method: "POST",
              body: JSON.stringify(data),
            }
          );
          showToast("Created", true);
        }
        setFormOpen(false);
        setEditingPk(null);
        setEditValues(null);
        await refreshRows(navStack, schema, offset, orderBy, orderDir, searchVal);
      } catch {
        // Error already toasted by apiFetch
      } finally {
        setFormSaving(false);
      }
    },
    [editingPk, curTable, navStack, schema, offset, orderBy, orderDir, searchVal, refreshRows]
  );

  // --- CRUD: Delete ---
  const handleConfirmDelete = useCallback((pkVal: string) => {
    setDeletePk(pkVal);
    setConfirmOpen(true);
  }, []);

  const handleDelete = useCallback(async () => {
    if (!deletePk) return;
    const table = curTable();
    if (!table) return;
    const pk = deletePk;
    setConfirmOpen(false);
    setDeletePk(null);
    try {
      await apiFetch(
        API +
          "/tables/" +
          encodeURIComponent(table) +
          "/rows/" +
          encodeURIComponent(pk),
        { method: "DELETE" }
      );
      showToast("Deleted", true);
      await refreshRows(navStack, schema, offset, orderBy, orderDir, searchVal);
    } catch {
      // Error already toasted
    }
  }, [deletePk, curTable, navStack, schema, offset, orderBy, orderDir, searchVal, refreshRows]);

  // --- Init ---
  useEffect(() => {
    if (authLoading) return;
    if (!user) return;

    (async () => {
      try {
        const [hierData, tablesData] = await Promise.all([
          apiFetch<AdminHierarchy>(API + "/hierarchy"),
          apiFetch<TableInfo[]>(API + "/tables"),
        ]);
        setHier(hierData);
        const counts: Record<string, number> = {};
        tablesData.forEach((t) => {
          counts[t.name] = t.row_count;
        });
        setTableCounts(counts);

        // Embed mode: navigate to requested table
        if (isEmbed && embedTable && embedTable !== "__dashboard__") {
          // Trigger after hierarchy is set
          setTimeout(() => {
            setShowDashboard(false);
            const newStack: NavEntry[] = [
              {
                table: embedTable,
                filterCol: null,
                filterVal: null,
                rowLabel: hierData.labels[embedTable] || embedTable,
              },
            ];
            setNavStack(newStack);
            setOffset(0);
            setOrderBy(null);
            setOrderDir("ASC");
            setSearchVal("");
            // Load
            (async () => {
              setTableLoading(true);
              try {
                const s = await apiFetch<TableSchema>(
                  API + "/tables/" + encodeURIComponent(embedTable) + "/schema"
                );
                setSchema(s);
                const url =
                  API +
                  "/tables/" +
                  encodeURIComponent(embedTable) +
                  "/rows?limit=" +
                  LIMIT +
                  "&offset=0";
                const data = await apiFetch<any>(url);
                setRows(data.rows);
                setTotal(data.total);
                setFkLabels(data.fk_labels || {});
              } catch (e: any) {
                if (e.message !== "auth") showToast("Failed to load data", false);
              } finally {
                setTableLoading(false);
              }
            })();
          }, 0);
        } else {
          // Show dashboard
          handleShowDashboard();
        }
      } catch (e: any) {
        if (e.message !== "auth") showToast("Failed to load admin data", false);
      }
    })();
  }, [authLoading, user]);

  // --- Keyboard shortcuts ---
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Let ExpandEditor handle its own Escape first
        if (document.querySelector(".editor-overlay.active")) return;
        if (formOpen) {
          setFormOpen(false);
          setEditingPk(null);
          return;
        }
        if (confirmOpen) {
          setConfirmOpen(false);
          setDeletePk(null);
          return;
        }
        setSidebarOpen(false);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [formOpen, confirmOpen]);

  // --- Embed mode class ---
  useEffect(() => {
    if (isEmbed) {
      document.body.classList.add("embed-mode");
      const s = document.createElement("style");
      s.textContent =
        ".embed-mode .sidebar{display:none!important}.embed-mode .sidebar-backdrop{display:none!important}.embed-mode .main{margin-left:0!important}.embed-mode .toolbar .sidebar-toggle{display:none!important}";
      document.head.appendChild(s);
      return () => {
        document.body.classList.remove("embed-mode");
        s.remove();
      };
    }
  }, [isEmbed]);

  // --- Sidebar open body class (for mobile CSS) ---
  useEffect(() => {
    if (sidebarOpen) {
      document.body.classList.add("sidebar-open");
    } else {
      document.body.classList.remove("sidebar-open");
    }
    return () => document.body.classList.remove("sidebar-open");
  }, [sidebarOpen]);

  // --- Determine child tabs ---
  const currentTable = curTable();
  const parentChildren: ChildDef[] =
    navStack.length >= 2 && hier
      ? tableChildren(navStack[navStack.length - 2].table)
      : [];
  const currentChildren: ChildDef[] = currentTable
    ? tableChildren(currentTable)
    : [];

  // --- Auth guard ---
  if (authLoading) {
    return (
      <div className="page-admin">
        <SvgSprite />
        <div className="main">
          <div className="empty" style={{ height: "100vh" }}>
            <div>Loading...</div>
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="page-admin">
        <SvgSprite />
        <LoginOverlay />
      </div>
    );
  }

  return (
    <div className="page-admin">
      <SvgSprite />
      <Script src="https://d3js.org/d3.v7.min.js" strategy="beforeInteractive" />

      {/* Sidebar */}
      {!isEmbed && (
        <>
          <AdminSidebar
            hierarchy={hier}
            tableCounts={tableCounts}
            activeTable={activeSidebarTable}
            onSelect={handleSidebarSelect}
          />
          <div
            className="sidebar-backdrop"
            style={{ display: sidebarOpen ? "block" : undefined }}
            onClick={() => setSidebarOpen(false)}
          />
        </>
      )}

      <div className="main">
        {/* Dashboard view */}
        {showDashboard && (
          <DashboardView
            stats={dashStats}
            loading={dashLoading}
            onDrill={dashDrill}
          />
        )}

        {/* Child tabs */}
        {!showDashboard && (
          <ChildTabs
            children={parentChildren}
            currentTable={currentTable || ""}
            onSwitch={switchChildTab}
          />
        )}

        {/* Toolbar */}
        <div className="toolbar">
          <button
            className="sidebar-toggle"
            onClick={() => setSidebarOpen((v) => !v)}
          >
            <Icon name="menu" size={18} />
          </button>
          <div style={{ display: "contents" }}>
            {showDashboard ? (
              <span className="bc-item current">Dashboard</span>
            ) : (
              <Breadcrumb
                navStack={navStack}
                tableLabel={tableLabel}
                onNavigate={navigateToLevel}
              />
            )}
          </div>
          {!showDashboard && (
            <div
              className="toolbar-actions"
              style={{
                display: "flex",
                marginLeft: "auto",
                gap: 10,
                alignItems: "center",
              }}
            >
              <input
                type="text"
                placeholder="Search..."
                value={searchVal}
                onChange={(e) => handleSearchChange(e.target.value)}
              />
              <button className="btn btn-primary" onClick={handleCreate}>
                <Icon name="plus" /> New
              </button>
              <button className="btn btn-secondary" onClick={handleRefresh}>
                <Icon name="refresh" /> Refresh
              </button>
            </div>
          )}
        </div>

        {/* Data table */}
        {!showDashboard && (
          <>
            <DataTable
              schema={schema}
              rows={rows}
              fkLabels={fkLabels}
              children={currentChildren}
              orderBy={orderBy}
              orderDir={orderDir}
              onSort={handleSort}
              onEdit={handleEdit}
              onDelete={handleConfirmDelete}
              onDrillDown={handleDrillDown}
              loading={tableLoading}
            />

            {/* Pagination */}
            {total > 0 && (
              <div className="pagination" style={{ display: "flex" }}>
                <div className="info">
                  Showing {offset + 1}-{Math.min(offset + LIMIT, total)} of{" "}
                  {total}
                </div>
                <button
                  className="pg-btn"
                  disabled={offset === 0}
                  onClick={handlePrev}
                >
                  Prev
                </button>
                <button
                  className="pg-btn"
                  disabled={offset + LIMIT >= total}
                  onClick={handleNext}
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Form modal (Create/Edit) */}
      {formOpen && schema && editingPk && !editValues && (
        <div className="overlay active" onClick={(e) => { if (e.target === e.currentTarget) { setFormOpen(false); setEditingPk(null); } }}>
          <div className="modal">
            <div className="modal-hd">
              <h3>Edit {tableLabel(curTable() || "")}</h3>
              <button className="modal-x" onClick={() => { setFormOpen(false); setEditingPk(null); }}>&times;</button>
            </div>
            <div className="modal-bd">
              <div style={{ textAlign: "center", padding: 20, color: "#64748b" }}>Loading...</div>
            </div>
          </div>
        </div>
      )}
      {formOpen && schema && (!editingPk || editValues) && (() => {
        const CustomForm = getFormComponent(schema.table);
        const formProps = {
          schema,
          values: editValues,
          editingPk,
          filterCol: curNav()?.filterCol ?? null,
          filterVal: curNav()?.filterVal ?? null,
          tableLabel: tableLabel(curTable() || ""),
          onSave: handleSave,
          onClose: () => {
            setFormOpen(false);
            setEditingPk(null);
            setEditValues(null);
          },
          saving: formSaving,
        };
        return CustomForm ? <CustomForm {...formProps} /> : <RowForm {...formProps} />;
      })()}

      {/* Confirm delete dialog */}
      {confirmOpen && (
        <div
          className="overlay active"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setConfirmOpen(false);
              setDeletePk(null);
            }
          }}
        >
          <div className="cbox">
            <p>
              Delete row {deletePk ? deletePk.substring(0, 12) + "..." : ""}?
            </p>
            <div className="row">
              <button
                className="btn btn-secondary"
                onClick={() => {
                  setConfirmOpen(false);
                  setDeletePk(null);
                }}
              >
                Cancel
              </button>
              <button className="btn btn-danger" onClick={handleDelete}>
                <Icon name="trash" /> Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AdminPage() {
  return (
    <Suspense>
      <AdminPageInner />
    </Suspense>
  );
}
