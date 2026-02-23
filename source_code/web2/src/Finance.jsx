import React, { useState, useEffect } from 'react';
import {
  LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import axiosInstance from './axios';
import './Finance.css';

const Finance = () => {
  const [monthlyStats, setMonthlyStats] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [visibleCategories, setVisibleCategories] = useState({
    Income: true,
    Electric: true,
    Gas: true,
    Internet: true,
    Mortgage: true,
    General: true,
    Food: true
  });
  const [timePeriod, setTimePeriod] = useState('all'); // 'all', 'last3', 'last6', 'last12', 'ytd', 'custom'
  const [customStartMonth, setCustomStartMonth] = useState('');
  const [customStartYear, setCustomStartYear] = useState('');
  const [customEndMonth, setCustomEndMonth] = useState('');
  const [customEndYear, setCustomEndYear] = useState('');
  const [showMonthSelection, setShowMonthSelection] = useState(false);
  const [excludeOutliers, setExcludeOutliers] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const categoryColors = {
    Income: '#10b981',
    Gas: '#f59e0b',
    Electric: '#3b82f6',
    Internet: '#8b5cf6',
    Mortgage: '#ef4444',
    General: '#ec4899',
    Food: '#14b8a6'
  };

  // Account nicknames mapping - customize these to your account names
  const accountNicknames = {
    'Peter Buonaiuto\nJoint Savings PERFORMANCE SAVINGS ...8900': 'Joint Savings',
    'Peter Buonaiuto\nJoint Checking CHECKING ...8012': 'Joint Checking',
    'Peter Buonaiuto\nWedding PERFORMANCE SAVINGS ...7737': 'Wedding Savings',
    'Card ...8839': 'Quicksilver',
    'Card ...7138': 'Savor',
  };

  // Helper function to get account display name
  const getAccountDisplayName = (accountName) => {
    return accountNicknames[accountName] || accountName;
  };

  // Load preferences from localStorage on mount
  useEffect(() => {
    const savedPrefs = localStorage.getItem('financePreferences');
    if (savedPrefs) {
      try {
        const prefs = JSON.parse(savedPrefs);
        if (prefs.visibleCategories) setVisibleCategories(prefs.visibleCategories);
        if (prefs.timePeriod) setTimePeriod(prefs.timePeriod);
        if (prefs.customStartMonth) setCustomStartMonth(prefs.customStartMonth);
        if (prefs.customStartYear) setCustomStartYear(prefs.customStartYear);
        if (prefs.customEndMonth) setCustomEndMonth(prefs.customEndMonth);
        if (prefs.customEndYear) setCustomEndYear(prefs.customEndYear);
        if (prefs.excludeOutliers !== undefined) setExcludeOutliers(prefs.excludeOutliers);
        if (prefs.selectedCategory) setSelectedCategory(prefs.selectedCategory);
      } catch (error) {
        console.error('Error loading preferences:', error);
      }
    }
    fetchFinanceData();
  }, []);

  // Save preferences to localStorage whenever they change
  useEffect(() => {
    const prefs = {
      visibleCategories,
      timePeriod,
      customStartMonth,
      customStartYear,
      customEndMonth,
      customEndYear,
      excludeOutliers,
      selectedCategory
    };
    localStorage.setItem('financePreferences', JSON.stringify(prefs));
  }, [visibleCategories, timePeriod, customStartMonth, customStartYear, customEndMonth, customEndYear, excludeOutliers, selectedCategory]);

  useEffect(() => {
    if (selectedCategory !== 'all') {
      fetchTransactionsByCategory(selectedCategory);
    } else {
      fetchAllTransactions();
    }
  }, [selectedCategory]);

  const fetchFinanceData = async () => {
    try {
      setLoading(true);
      const [statsRes, transactionsRes] = await Promise.all([
        axiosInstance.get('/monthly-stats'),
        axiosInstance.get('/transactions')
      ]);
      setMonthlyStats(statsRes.data);
      setTransactions(transactionsRes.data);
    } catch (error) {
      console.error('Error fetching finance data:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchAllTransactions = async () => {
    try {
      const res = await axiosInstance.get('/transactions');
      setTransactions(res.data);
    } catch (error) {
      console.error('Error fetching transactions:', error);
    }
  };

  const fetchTransactionsByCategory = async (category) => {
    try {
      const res = await axiosInstance.get(`/transactions/${category}`);
      setTransactions(res.data);
    } catch (error) {
      console.error('Error fetching transactions:', error);
    }
  };

  const toggleCategory = (category) => {
    setVisibleCategories(prev => ({
      ...prev,
      [category]: !prev[category]
    }));
  };

  // Detect outliers using IQR method for a specific category
  const detectOutliers = (category) => {
    const values = monthlyStats
      .map(stat => stat.categories[category] || 0)
      .filter(val => val > 0) // Only consider non-zero values
      .sort((a, b) => a - b);

    if (values.length < 4) return new Set(); // Need at least 4 data points

    const q1Index = Math.floor(values.length * 0.25);
    const q3Index = Math.floor(values.length * 0.75);
    const q1 = values[q1Index];
    const q3 = values[q3Index];
    const iqr = q3 - q1;
    const lowerBound = q1 - 1.5 * iqr;
    const upperBound = q3 + 1.5 * iqr;

    const outlierMonths = new Set();
    monthlyStats.forEach(stat => {
      const value = stat.categories[category] || 0;
      if (value > 0 && (value < lowerBound || value > upperBound)) {
        outlierMonths.add(`${stat.month}/${stat.year}`);
      }
    });

    return outlierMonths;
  };

  // Get category average (excluding outliers and income)
  const getCategoryAverage = (category) => {
    if (category === 'Income') return 0; // Don't average income

    const outliers = detectOutliers(category);
    const validValues = monthlyStats
      .filter(stat => {
        const monthKey = `${stat.month}/${stat.year}`;
        return !outliers.has(monthKey);
      })
      .map(stat => stat.categories[category] || 0)
      .filter(val => val > 0);

    if (validValues.length === 0) return 0;
    return validValues.reduce((sum, val) => sum + val, 0) / validValues.length;
  };

  // Check if a specific category is an outlier for a given month
  // Only check General category for outliers
  const isCategoryOutlier = (category, month, year) => {
    if (!excludeOutliers || category !== 'General') return false;
    const monthKey = `${month}/${year}`;
    const outliers = detectOutliers(category);
    return outliers.has(monthKey);
  };

  // Get date range based on time period selection
  const getDateRange = () => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1; // 1-12

    if (timePeriod === 'all') {
      return { startMonth: null, startYear: null, endMonth: null, endYear: null };
    } else if (timePeriod === 'last3') {
      const date = new Date(currentYear, currentMonth - 4, 1); // 3 months ago
      return {
        startMonth: date.getMonth() + 1,
        startYear: date.getFullYear(),
        endMonth: currentMonth,
        endYear: currentYear
      };
    } else if (timePeriod === 'last6') {
      const date = new Date(currentYear, currentMonth - 7, 1);
      return {
        startMonth: date.getMonth() + 1,
        startYear: date.getFullYear(),
        endMonth: currentMonth,
        endYear: currentYear
      };
    } else if (timePeriod === 'last12') {
      const date = new Date(currentYear, currentMonth - 13, 1);
      return {
        startMonth: date.getMonth() + 1,
        startYear: date.getFullYear(),
        endMonth: currentMonth,
        endYear: currentYear
      };
    } else if (timePeriod === 'ytd') {
      return { startMonth: 1, startYear: currentYear, endMonth: currentMonth, endYear: currentYear };
    } else if (timePeriod === 'custom') {
      return {
        startMonth: parseInt(customStartMonth) || null,
        startYear: parseInt(customStartYear) || null,
        endMonth: parseInt(customEndMonth) || null,
        endYear: parseInt(customEndYear) || null
      };
    }
    return { startMonth: null, startYear: null, endMonth: null, endYear: null };
  };

  // Check if a month/year is within the selected range
  const isInDateRange = (month, year) => {
    const range = getDateRange();
    if (!range.startMonth || !range.startYear || !range.endMonth || !range.endYear) {
      return true; // Show all if no range specified
    }

    const statDate = year * 12 + month;
    const startDate = range.startYear * 12 + range.startMonth;
    const endDate = range.endYear * 12 + range.endMonth;

    return statDate >= startDate && statDate <= endDate;
  };

  // Check if a transaction date is within the selected range
  const isTransactionInDateRange = (dateString) => {
    const range = getDateRange();
    if (!range.startMonth || !range.startYear || !range.endMonth || !range.endYear) {
      return true; // Show all if no range specified
    }

    const date = new Date(dateString);
    const month = date.getMonth() + 1;
    const year = date.getFullYear();

    const transactionDate = year * 12 + month;
    const startDate = range.startYear * 12 + range.startMonth;
    const endDate = range.endYear * 12 + range.endMonth;

    return transactionDate >= startDate && transactionDate <= endDate;
  };

  // Transform monthly stats for line chart (replace outlier categories with averages)
  const getChartData = () => {
    return monthlyStats
      .filter(stat => isInDateRange(stat.month, stat.year))
      .map(stat => {
        const smoothedCategories = {};
        Object.keys(stat.categories).forEach(category => {
          if (isCategoryOutlier(category, stat.month, stat.year)) {
            // Replace outlier with average for this category
            smoothedCategories[category] = getCategoryAverage(category);
          } else {
            // Keep original value
            smoothedCategories[category] = stat.categories[category];
          }
        });
        return {
          month: `${stat.month}/${stat.year}`,
          ...smoothedCategories
        };
      });
  };

  // Calculate monthly averages for pie chart (using smoothed data)
  const getAverageData = () => {
    if (monthlyStats.length === 0) return [];

    const totals = {
      Electric: 0,
      Gas: 0,
      Internet: 0,
      Mortgage: 0,
      General: 0,
      Food: 0,
      Income: 0
    };

    const filteredStats = monthlyStats.filter(stat => isInDateRange(stat.month, stat.year));

    filteredStats.forEach(stat => {
      Object.keys(totals).forEach(category => {
        if (isCategoryOutlier(category, stat.month, stat.year)) {
          // Use average for outlier categories
          totals[category] += getCategoryAverage(category);
        } else {
          // Use actual value for non-outliers
          totals[category] += stat.categories[category] || 0;
        }
      });
    });

    const monthCount = filteredStats.length || 1;
    const averages = Object.keys(totals).map(category => ({
      name: category,
      value: parseFloat((totals[category] / monthCount).toFixed(2))
    }));

    return averages.filter(item => item.name !== 'Income' && visibleCategories[item.name]);
  };

  // Calculate net income (always uses ACTUAL values, never smoothed - shows reality)
  const getNetIncome = () => {
    if (monthlyStats.length === 0) return { lastMonth: 0, average: 0 };

    // Always use actual values for net income
    const lastMonthStats = monthlyStats[monthlyStats.length - 1];
    const lastMonthIncome = lastMonthStats?.categories?.Income || 0;
    const lastMonthExpenses = lastMonthStats?.totalExpenses || 0;
    const lastMonthNet = lastMonthIncome - lastMonthExpenses;

    // Calculate average across ALL months with actual expenses
    let totalNet = 0;
    monthlyStats.forEach(stat => {
      const income = stat.categories?.Income || 0;
      const expenses = stat.totalExpenses || 0;
      totalNet += (income - expenses);
    });

    const averageNet = totalNet / monthlyStats.length;

    return {
      lastMonth: lastMonthNet.toFixed(2),
      average: averageNet.toFixed(2)
    };
  };

  // Calculate income stats
  const getIncome = () => {
    if (monthlyStats.length === 0) return { lastMonth: 0, average: 0 };

    const lastMonthStats = monthlyStats[monthlyStats.length - 1];
    const lastMonthIncome = lastMonthStats?.categories?.Income || 0;

    let totalIncome = 0;
    monthlyStats.forEach(stat => {
      totalIncome += stat.categories?.Income || 0;
    });

    const averageIncome = totalIncome / monthlyStats.length;

    return {
      lastMonth: lastMonthIncome.toFixed(2),
      average: averageIncome.toFixed(2)
    };
  };

  // Filter transactions by date range and search query
  const getFilteredTransactions = () => {
    return transactions.filter(transaction => {
      // Filter by date range
      if (!isTransactionInDateRange(transaction.date)) return false;

      // Filter by search query
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const description = (transaction.description || '').toLowerCase();
        const account = (transaction.account || '').toLowerCase();
        const amount = transaction.amount?.toString() || '';

        return description.includes(query) ||
               account.includes(query) ||
               amount.includes(query);
      }

      return true;
    });
  };

  const formatCurrency = (value) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(value);
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const netIncome = getNetIncome();
  const income = getIncome();
  const chartData = getChartData();
  const averageData = getAverageData();

  if (loading) {
    return (
      <div className="finance-container">
        <div className="loading-spinner">Loading finance data...</div>
      </div>
    );
  }

  return (
    <div className="finance-container">
      <div className="finance-header">
        <div className="net-income-cards">
          
          <div className="income-card">
            <div className="card-label">Latest Income</div>
            <div className="card-value positive">
              {formatCurrency(income.lastMonth)}
            </div>
            <div className="card-sublabel">Average Income</div>
            <div className="card-subvalue positive">
              {formatCurrency(income.average)}
            </div>
          </div>
          <div className="income-card">
            <div className="card-label">Latest Net Income</div>
            <div className={`card-value ${parseFloat(netIncome.lastMonth) >= 0 ? 'positive' : 'negative'}`}>
              {formatCurrency(netIncome.lastMonth)}
            </div>
            <div className="card-sublabel">Average Net Income</div>
            <div className={`card-subvalue ${parseFloat(netIncome.average) >= 0 ? 'positive' : 'negative'}`}>
              {formatCurrency(netIncome.average)}
            </div>
          </div>
        </div>
      </div>

      {/* Category Toggles */}
      <div className="category-toggles">
        <div className="toggles-header">
          <h3>Toggle Categories:</h3>
          <label className="outlier-toggle">
            <input
              type="checkbox"
              checked={excludeOutliers}
              onChange={(e) => setExcludeOutliers(e.target.checked)}
            />
            <span>Exclude Outliers (e.g., renovations)</span>
          </label>
        </div>
        <div className="toggle-buttons">
          {Object.keys(categoryColors).map(category => (
            <button
              key={category}
              className={`toggle-btn ${visibleCategories[category] ? 'active' : ''}`}
              style={{
                backgroundColor: visibleCategories[category] ? categoryColors[category] : '#e5e7eb',
                color: visibleCategories[category] ? 'white' : '#6b7280'
              }}
              onClick={() => toggleCategory(category)}
            >
              {category}
            </button>
          ))}
        </div>
      </div>

      {/* Time Period Filter */}
      <div className="month-selection">
        <div className="month-selection-header">
          <button
            className="month-selection-toggle"
            onClick={() => setShowMonthSelection(!showMonthSelection)}
          >
            <span>Time Period Filter</span>
            <span className={`arrow ${showMonthSelection ? 'expanded' : ''}`}>▼</span>
          </button>
        </div>
        {showMonthSelection && (
          <div className="time-period-content">
            {/* Preset Buttons */}
            <div className="time-period-presets">
              <button
                className={`preset-btn ${timePeriod === 'all' ? 'active' : ''}`}
                onClick={() => setTimePeriod('all')}
              >
                All Time
              </button>
              <button
                className={`preset-btn ${timePeriod === 'last3' ? 'active' : ''}`}
                onClick={() => setTimePeriod('last3')}
              >
                Last 3 Months
              </button>
              <button
                className={`preset-btn ${timePeriod === 'last6' ? 'active' : ''}`}
                onClick={() => setTimePeriod('last6')}
              >
                Last 6 Months
              </button>
              <button
                className={`preset-btn ${timePeriod === 'last12' ? 'active' : ''}`}
                onClick={() => setTimePeriod('last12')}
              >
                Last 12 Months
              </button>
              <button
                className={`preset-btn ${timePeriod === 'ytd' ? 'active' : ''}`}
                onClick={() => setTimePeriod('ytd')}
              >
                Year to Date
              </button>
              <button
                className={`preset-btn ${timePeriod === 'custom' ? 'active' : ''}`}
                onClick={() => setTimePeriod('custom')}
              >
                Custom Range
              </button>
            </div>

            {/* Custom Range Selector */}
            {timePeriod === 'custom' && (
              <div className="custom-range">
                <div className="range-inputs">
                  <div className="range-group">
                    <label>From:</label>
                    <select
                      value={customStartMonth}
                      onChange={(e) => setCustomStartMonth(e.target.value)}
                      className="month-select"
                    >
                      <option value="">Month</option>
                      {[...Array(12)].map((_, i) => (
                        <option key={i + 1} value={i + 1}>
                          {new Date(2000, i).toLocaleDateString('en-US', { month: 'short' })}
                        </option>
                      ))}
                    </select>
                    <select
                      value={customStartYear}
                      onChange={(e) => setCustomStartYear(e.target.value)}
                      className="year-select"
                    >
                      <option value="">Year</option>
                      {monthlyStats.map(stat => stat.year)
                        .filter((year, index, self) => self.indexOf(year) === index)
                        .sort((a, b) => a - b)
                        .map(year => (
                          <option key={year} value={year}>{year}</option>
                        ))}
                    </select>
                  </div>
                  <div className="range-group">
                    <label>To:</label>
                    <select
                      value={customEndMonth}
                      onChange={(e) => setCustomEndMonth(e.target.value)}
                      className="month-select"
                    >
                      <option value="">Month</option>
                      {[...Array(12)].map((_, i) => (
                        <option key={i + 1} value={i + 1}>
                          {new Date(2000, i).toLocaleDateString('en-US', { month: 'short' })}
                        </option>
                      ))}
                    </select>
                    <select
                      value={customEndYear}
                      onChange={(e) => setCustomEndYear(e.target.value)}
                      className="year-select"
                    >
                      <option value="">Year</option>
                      {monthlyStats.map(stat => stat.year)
                        .filter((year, index, self) => self.indexOf(year) === index)
                        .sort((a, b) => a - b)
                        .map(year => (
                          <option key={year} value={year}>{year}</option>
                        ))}
                    </select>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Charts Grid - Side by Side on Desktop */}
      <div className="charts-grid">
        {/* Line Chart - Monthly Trends */}
        <div className="chart-section">
          <h2>Monthly Trends</h2>
          <div className="chart-container">
            <ResponsiveContainer width="100%" height={400}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="month" stroke="#6b7280" />
                <YAxis stroke="#6b7280" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#fff',
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px'
                  }}
                  formatter={(value) => formatCurrency(value)}
                />
                <Legend />
                {Object.keys(categoryColors).map(category => (
                  visibleCategories[category] && (
                    <Line
                      key={category}
                      type="monotone"
                      dataKey={category}
                      stroke={categoryColors[category]}
                      strokeWidth={2}
                      dot={{ r: 4 }}
                      activeDot={{ r: 6 }}
                    />
                  )
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Pie Chart - Monthly Averages */}
        <div className="chart-section">
          <h2>Average Monthly Expenses</h2>
          <div className="chart-container pie-chart-container">
            <ResponsiveContainer width="100%" height={400}>
              <PieChart>
                <Pie
                  data={averageData}
                  cx="50%"
                  cy="50%"
                  labelLine={true}
                  label={({ name, value }) => `${name}: ${formatCurrency(value)}`}
                  outerRadius={120}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {averageData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={categoryColors[entry.name]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => formatCurrency(value)} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Transactions List */}
      <div className="transactions-section">
        <div className="transactions-header">
          <h2>Transactions</h2>
          <div className="transaction-filters">
            <input
              type="text"
              className="transaction-search"
              placeholder="Search transactions..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <select
              className="category-filter"
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
            >
              <option value="all">All Categories</option>
              {Object.keys(categoryColors).map(category => (
                <option key={category} value={category}>{category}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="transactions-list">
          {getFilteredTransactions().length === 0 ? (
            <div className="no-transactions">No transactions found</div>
          ) : (
            getFilteredTransactions().map((transaction) => (
              <div key={transaction._id} className="transaction-item">
                <div className="transaction-left">
                  <div className="transaction-date">{formatDate(transaction.date)}</div>
                  <div className="transaction-description">{transaction.description}</div>
                  {transaction.account && (
                    <div className="transaction-account">{getAccountDisplayName(transaction.account)}</div>
                  )}
                </div>
                <div className="transaction-right">
                  <div
                    className="transaction-category"
                    style={{ backgroundColor: categoryColors[transaction.category] }}
                  >
                    {transaction.category}
                  </div>
                  <div className={`transaction-amount ${(transaction.amount > 0 && transaction.category === "Income") || (transaction.amount < 0) ? 'income' : 'expense'}`}>
                    {(transaction.amount > 0 && transaction.category === "Income") || (transaction.amount < 0 ) ? '+' : '-'}{formatCurrency(Math.abs(transaction.amount))}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default Finance;
