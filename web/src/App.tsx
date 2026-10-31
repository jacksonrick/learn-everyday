import { Navigate, Route, Routes } from 'react-router-dom'
import ClientLayout from '@/components/client/layout'
import HomePage from '@/pages/client/Home'
import ChinesePage from '@/pages/client/Chinese'
import MathPage from '@/pages/client/Math'
import EnglishPage from '@/pages/client/English'
import MePage from '@/pages/client/Me'
import AdminLogin from '@/pages/admin/Login'
import AdminLayout from '@/pages/admin/Layout'
import Dashboard from '@/pages/admin/Dashboard'
import ChildrenPage from '@/pages/admin/Children'
import BankPage, { BANK_CONFIGS } from '@/pages/admin/Bank'
import RecordsPage from '@/pages/admin/Records'
import RecitationsPage from '@/pages/admin/Recitations'
import CheckinsPage from '@/pages/admin/Checkins'
import PointsPage from '@/pages/admin/Points'
import RewardsPage from '@/pages/admin/Rewards'
import SettingsPage from '@/pages/admin/Settings'
import { getToken } from '@/lib/api'

function RequireAuth({ children }: { children: JSX.Element }) {
  if (!getToken()) return <Navigate to="/admin/login" replace />
  return children
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<ClientLayout />}>
        <Route index element={<HomePage />} />
        <Route path="c/chinese" element={<ChinesePage />} />
        <Route path="c/math" element={<MathPage />} />
        <Route path="c/english" element={<EnglishPage />} />
        <Route path="me" element={<MePage />} />
      </Route>

      <Route path="/admin/login" element={<AdminLogin />} />
      <Route
        path="/admin"
        element={
          <RequireAuth>
            <AdminLayout />
          </RequireAuth>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="children" element={<ChildrenPage />} />
        {BANK_CONFIGS.map((cfg) => (
          <Route key={cfg.key} path={cfg.path} element={<BankPage key={cfg.key} config={cfg} />} />
        ))}
        <Route path="records" element={<RecordsPage />} />
        <Route path="recitations" element={<RecitationsPage />} />
        <Route path="checkins" element={<CheckinsPage />} />
        <Route path="points" element={<PointsPage />} />
        <Route path="rewards" element={<RewardsPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
