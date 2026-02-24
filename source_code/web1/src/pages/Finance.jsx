// Finance.jsx — moved to pages/, logic identical to original
// All data fetching, charting, transaction filtering preserved exactly.

import React, { useState, useEffect } from "react";
import {
  LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { getMonthlyStats, getTransactions, getTransactionsByCategory } from "../api";
import { formatCurrency, formatDate, CATEGORY_COLORS, getAccountName } from "../utils";
import "../styles/Finance.css";

export default function Finance() {
  const [monthlyStats, setMonthlyStats] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading]           = useState(true);
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [visibleCategories, setVisibleCategories] = useState({
    Income: true, Electric: true, Gas: true, Internet: true,
    Mortgage: true, General: true, Food: true,
  });
  const [timePeriod, setTimePeriod]           = useState("all");
  const [customStartMonth, setCustomStartMonth] = useState("");
  const [customStartYear,  setCustomStartYear]  = useState("");
  const [customEndMonth,   setCustomEndMonth]   = useState("");
  const [customEndYear,    setCustomEndYear]    = useState("");
  const [showMonthSelection, setShowMonthSelection] = useState(false);
  const [excludeOutliers, setExcludeOutliers]   = useState(false);
  const [searchQuery, setSearchQuery]           = useState("");

  // Persist preferences
  useEffect(() => {
    const saved = localStorage.getItem("financePreferences");
    if (saved) {
      try {
        const p = JSON.parse(saved);
        if (p.visibleCategories) setVisibleCategories(p.visibleCategories);
        if (p.timePeriod)        setTimePeriod(p.timePeriod);
        if (p.customStartMonth)  setCustomStartMonth(p.customStartMonth);
        if (p.customStartYear)   setCustomStartYear(p.customStartYear);
        if (p.customEndMonth)    setCustomEndMonth(p.customEndMonth);
        if (p.customEndYear)     setCustomEndYear(p.customEndYear);
        if (p.excludeOutliers !== undefined) setExcludeOutliers(p.excludeOutliers);
        if (p.selectedCategory)  setSelectedCategory(p.selectedCategory);
      } catch {}
    }
    fetchFinanceData();
  }, []);

  useEffect(() => {
    localStorage.setItem("financePreferences", JSON.stringify({
      visibleCategories, timePeriod, customStartMonth, customStartYear,
      customEndMonth, customEndYear, excludeOutliers, selectedCategory,
    }));
  }, [visibleCategories, timePeriod, customStartMonth, customStartYear, customEndMonth, customEndYear, excludeOutliers, selectedCategory]);

  useEffect(() => {
    selectedCategory !== "all"
      ? fetchTransactionsByCategory(selectedCategory)
      : fetchAllTransactions();
  }, [selectedCategory]);

  const fetchFinanceData = async () => {
    try {
      setLoading(true);
      const [statsRes, txRes] = await Promise.all([getMonthlyStats(), getTransactions()]);
      setMonthlyStats(statsRes.data);
      setTransactions(txRes.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const fetchAllTransactions = async () => {
    try { setTransactions((await getTransactions()).data); } catch {}
  };

  const fetchTransactionsByCategory = async (cat) => {
    try { setTransactions((await getTransactionsByCategory(cat)).data); } catch {}
  };

  const toggleCategory = (cat) =>
    setVisibleCategories(prev => ({ ...prev, [cat]: !prev[cat] }));

  const detectOutliers = (category) => {
    const values = monthlyStats
      .map(s => s.categories[category] || 0).filter(v => v > 0).sort((a, b) => a - b);
    if (values.length < 4) return new Set();
    const q1 = values[Math.floor(values.length * 0.25)];
    const q3 = values[Math.floor(values.length * 0.75)];
    const iqr = q3 - q1;
    const lo = q1 - 1.5 * iqr, hi = q3 + 1.5 * iqr;
    const out = new Set();
    monthlyStats.forEach(s => {
      const v = s.categories[category] || 0;
      if (v > 0 && (v < lo || v > hi)) out.add(`${s.month}/${s.year}`);
    });
    return out;
  };

  const getCategoryAverage = (category) => {
    if (category === "Income") return 0;
    const out = detectOutliers(category);
    const valid = monthlyStats
      .filter(s => !out.has(`${s.month}/${s.year}`))
      .map(s => s.categories[category] || 0).filter(v => v > 0);
    return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : 0;
  };

  const isCategoryOutlier = (category, month, year) => {
    if (!excludeOutliers || category !== "General") return false;
    return detectOutliers(category).has(`${month}/${year}`);
  };

  const getDateRange = () => {
    const now = new Date(), cm = now.getMonth() + 1, cy = now.getFullYear();
    if (timePeriod === "all")    return {};
    if (timePeriod === "last3")  { const d = new Date(cy, cm - 4, 1); return { startMonth: d.getMonth()+1, startYear: d.getFullYear(), endMonth: cm, endYear: cy }; }
    if (timePeriod === "last6")  { const d = new Date(cy, cm - 7, 1); return { startMonth: d.getMonth()+1, startYear: d.getFullYear(), endMonth: cm, endYear: cy }; }
    if (timePeriod === "last12") { const d = new Date(cy, cm-13, 1);  return { startMonth: d.getMonth()+1, startYear: d.getFullYear(), endMonth: cm, endYear: cy }; }
    if (timePeriod === "ytd")    return { startMonth: 1, startYear: cy, endMonth: cm, endYear: cy };
    if (timePeriod === "custom") return {
      startMonth: +customStartMonth || null, startYear: +customStartYear || null,
      endMonth:   +customEndMonth   || null, endYear:   +customEndYear   || null,
    };
    return {};
  };

  const inRange = (month, year) => {
    const { startMonth, startYear, endMonth, endYear } = getDateRange();
    if (!startMonth) return true;
    const d = year * 12 + month, s = startYear * 12 + startMonth, e = endYear * 12 + endMonth;
    return d >= s && d <= e;
  };

  const txInRange = (dateStr) => {
    const { startMonth, startYear, endMonth, endYear } = getDateRange();
    if (!startMonth) return true;
    const dt = new Date(dateStr), m = dt.getMonth()+1, y = dt.getFullYear();
    return (y * 12 + m) >= (startYear * 12 + startMonth) && (y * 12 + m) <= (endYear * 12 + endMonth);
  };

  const getChartData = () =>
    monthlyStats.filter(s => inRange(s.month, s.year)).map(s => {
      const cats = {};
      Object.keys(s.categories).forEach(cat => {
        cats[cat] = isCategoryOutlier(cat, s.month, s.year)
          ? getCategoryAverage(cat) : s.categories[cat];
      });
      return { month: `${s.month}/${s.year}`, ...cats };
    });

  const getAverageData = () => {
    if (!monthlyStats.length) return [];
    const totals = { Electric: 0, Gas: 0, Internet: 0, Mortgage: 0, General: 0, Food: 0, Income: 0 };
    const filtered = monthlyStats.filter(s => inRange(s.month, s.year));
    filtered.forEach(s => {
      Object.keys(totals).forEach(cat => {
        totals[cat] += isCategoryOutlier(cat, s.month, s.year)
          ? getCategoryAverage(cat) : (s.categories[cat] || 0);
      });
    });
    const n = filtered.length || 1;
    return Object.keys(totals)
      .filter(k => k !== "Income" && visibleCategories[k])
      .map(k => ({ name: k, value: parseFloat((totals[k] / n).toFixed(2)) }));
  };

  const getNetIncome = () => {
    if (!monthlyStats.length) return { lastMonth: 0, average: 0 };
    const last = monthlyStats[monthlyStats.length - 1];
    const lastNet = (last?.categories?.Income || 0) - (last?.totalExpenses || 0);
    const avgNet  = monthlyStats.reduce((sum, s) => sum + ((s.categories?.Income || 0) - (s.totalExpenses || 0)), 0) / monthlyStats.length;
    return { lastMonth: lastNet.toFixed(2), average: avgNet.toFixed(2) };
  };

  const getIncome = () => {
    if (!monthlyStats.length) return { lastMonth: 0, average: 0 };
    const last = monthlyStats[monthlyStats.length - 1];
    const avg  = monthlyStats.reduce((sum, s) => sum + (s.categories?.Income || 0), 0) / monthlyStats.length;
    return { lastMonth: (last?.categories?.Income || 0).toFixed(2), average: avg.toFixed(2) };
  };

  const getFilteredTransactions = () =>
    transactions.filter(t => {
      if (!txInRange(t.date)) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (t.description || "").toLowerCase().includes(q)
          || (t.account || "").toLowerCase().includes(q)
          || (t.amount?.toString() || "").includes(q);
      }
      return true;
    });

  const netIncome = getNetIncome();
  const income    = getIncome();

  if (loading) return <div className="finance-container"><div className="loading-spinner">Loading finance data...</div></div>;

  return (
    <div className="finance-container">
      <div className="finance-header">
        <div className="net-income-cards">
          <div className="income-card">
            <div className="card-label">Latest Income</div>
            <div className="card-value positive">{formatCurrency(income.lastMonth)}</div>
            <div className="card-sublabel">Average Income</div>
            <div className="card-subvalue positive">{formatCurrency(income.average)}</div>
          </div>
          <div className="income-card">
            <div className="card-label">Latest Net Income</div>
            <div className={`card-value ${+netIncome.lastMonth >= 0 ? "positive" : "negative"}`}>{formatCurrency(netIncome.lastMonth)}</div>
            <div className="card-sublabel">Average Net Income</div>
            <div className={`card-subvalue ${+netIncome.average >= 0 ? "positive" : "negative"}`}>{formatCurrency(netIncome.average)}</div>
          </div>
        </div>
      </div>

      <div className="category-toggles">
        <div className="toggles-header">
          <h3>Toggle Categories:</h3>
          <label className="outlier-toggle">
            <input type="checkbox" checked={excludeOutliers} onChange={e => setExcludeOutliers(e.target.checked)} />
            <span>Exclude Outliers (e.g., renovations)</span>
          </label>
        </div>
        <div className="toggle-buttons">
          {Object.keys(CATEGORY_COLORS).map(cat => (
            <button key={cat} className={`toggle-btn ${visibleCategories[cat] ? "active" : ""}`}
              style={{ backgroundColor: visibleCategories[cat] ? CATEGORY_COLORS[cat] : "#e5e7eb", color: visibleCategories[cat] ? "white" : "#6b7280" }}
              onClick={() => toggleCategory(cat)}>{cat}</button>
          ))}
        </div>
      </div>

      <div className="month-selection">
        <div className="month-selection-header">
          <button className="month-selection-toggle" onClick={() => setShowMonthSelection(v => !v)}>
            <span>Time Period Filter</span>
            <span className={`arrow ${showMonthSelection ? "expanded" : ""}`}>▼</span>
          </button>
        </div>
        {showMonthSelection && (
          <div className="time-period-content">
            <div className="time-period-presets">
              {[["all","All Time"],["last3","Last 3 Months"],["last6","Last 6 Months"],["last12","Last 12 Months"],["ytd","Year to Date"],["custom","Custom Range"]].map(([val, label]) => (
                <button key={val} className={`preset-btn ${timePeriod === val ? "active" : ""}`} onClick={() => setTimePeriod(val)}>{label}</button>
              ))}
            </div>
            {timePeriod === "custom" && (
              <div className="custom-range">
                <div className="range-inputs">
                  {[["From", customStartMonth, setCustomStartMonth, customStartYear, setCustomStartYear],
                    ["To",   customEndMonth,   setCustomEndMonth,   customEndYear,   setCustomEndYear]].map(([lbl, m, setM, y, setY]) => (
                    <div key={lbl} className="range-group">
                      <label>{lbl}:</label>
                      <select value={m} onChange={e => setM(e.target.value)} className="month-select">
                        <option value="">Month</option>
                        {[...Array(12)].map((_,i) => <option key={i+1} value={i+1}>{new Date(2000,i).toLocaleDateString("en-US",{month:"short"})}</option>)}
                      </select>
                      <select value={y} onChange={e => setY(e.target.value)} className="year-select">
                        <option value="">Year</option>
                        {[...new Set(monthlyStats.map(s => s.year))].sort().map(yr => <option key={yr} value={yr}>{yr}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="charts-grid">
        <div className="chart-section">
          <h2>Monthly Trends</h2>
          <div className="chart-container">
            <ResponsiveContainer width="100%" height={400}>
              <LineChart data={getChartData()}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="month" stroke="#6b7280" />
                <YAxis stroke="#6b7280" />
                <Tooltip contentStyle={{ backgroundColor: "#fff", border: "1px solid #e5e7eb", borderRadius: 8 }} formatter={v => formatCurrency(v)} />
                <Legend />
                {Object.keys(CATEGORY_COLORS).map(cat => visibleCategories[cat] && (
                  <Line key={cat} type="monotone" dataKey={cat} stroke={CATEGORY_COLORS[cat]} strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="chart-section">
          <h2>Average Monthly Expenses</h2>
          <div className="chart-container pie-chart-container">
            <ResponsiveContainer width="100%" height={400}>
              <PieChart>
                <Pie data={getAverageData()} cx="50%" cy="50%" labelLine label={({ name, value }) => `${name}: ${formatCurrency(value)}`} outerRadius={120} dataKey="value">
                  {getAverageData().map((entry, i) => <Cell key={i} fill={CATEGORY_COLORS[entry.name]} />)}
                </Pie>
                <Tooltip formatter={v => formatCurrency(v)} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="transactions-section">
        <div className="transactions-header">
          <h2>Transactions</h2>
          <div className="transaction-filters">
            <input type="text" className="transaction-search" placeholder="Search transactions..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
            <select className="category-filter" value={selectedCategory} onChange={e => setSelectedCategory(e.target.value)}>
              <option value="all">All Categories</option>
              {Object.keys(CATEGORY_COLORS).map(cat => <option key={cat} value={cat}>{cat}</option>)}
            </select>
          </div>
        </div>
        <div className="transactions-list">
          {getFilteredTransactions().length === 0
            ? <div className="no-transactions">No transactions found</div>
            : getFilteredTransactions().map(t => (
              <div key={t._id} className="transaction-item">
                <div className="transaction-left">
                  <div className="transaction-date">{formatDate(t.date)}</div>
                  <div className="transaction-description">{t.description}</div>
                  {t.account && <div className="transaction-account">{getAccountName(t.account)}</div>}
                </div>
                <div className="transaction-right">
                  <div className="transaction-category" style={{ backgroundColor: CATEGORY_COLORS[t.category] }}>{t.category}</div>
                  <div className={`transaction-amount ${(t.amount > 0 && t.category === "Income") || t.amount < 0 ? "income" : "expense"}`}>
                    {(t.amount > 0 && t.category === "Income") || t.amount < 0 ? "+" : "-"}{formatCurrency(Math.abs(t.amount))}
                  </div>
                </div>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
