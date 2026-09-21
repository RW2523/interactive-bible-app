import { BookOpen, Compass, Home as HomeIcon, Loader2, Search } from "lucide-react";
import { lazy, Suspense, useEffect, type ReactNode } from "react";
import { Link, Navigate, Route, Routes, useLocation, type Location } from "react-router-dom";
import { useAuth } from "./auth/AuthContext";
import { AppShell, openCommandPalette } from "./components/layout/AppShell";
import { buttonClass } from "./components/page";
import { ClipModal, ClipPage } from "./pages/ClipPage";
import { HomePage } from "./pages/HomePage";
import { LibraryPage } from "./pages/LibraryPage";
import { ReadPage, ReadRedirect, VersePage } from "./pages/ReadPage";
import { ResourcePage } from "./pages/ResourcePage";
import { SearchPage } from "./pages/SearchPage";

// Admin tools, the Scripture Map and the sign-in pages load on demand so the reader opens fast.
const AdminLayout = lazy(() => import("./pages/admin/AdminLayout").then((m) => ({ default: m.AdminLayout })));
const IngestPage = lazy(() => import("./pages/admin/ContentPages").then((m) => ({ default: m.IngestPage })));
const ResourceAdminPage = lazy(() => import("./pages/admin/ContentPages").then((m) => ({ default: m.ResourceAdminPage })));
const ResourcesMonitorPage = lazy(() => import("./pages/admin/ContentPages").then((m) => ({ default: m.ResourcesMonitorPage })));
const AdminDashboard = lazy(() => import("./pages/admin/OpsPages").then((m) => ({ default: m.AdminDashboard })));
const AuditPage = lazy(() => import("./pages/admin/OpsPages").then((m) => ({ default: m.AuditPage })));
const FeedbackAdminPage = lazy(() => import("./pages/admin/OpsPages").then((m) => ({ default: m.FeedbackAdminPage })));
const MetricsPage = lazy(() => import("./pages/admin/OpsPages").then((m) => ({ default: m.MetricsPage })));
const SystemPage = lazy(() => import("./pages/admin/OpsPages").then((m) => ({ default: m.SystemPage })));
const VocabularyPage = lazy(() => import("./pages/admin/OpsPages").then((m) => ({ default: m.VocabularyPage })));
const MappingReviewPage = lazy(() => import("./pages/admin/ReviewPages").then((m) => ({ default: m.MappingReviewPage })));
const ReviewQueuePage = lazy(() => import("./pages/admin/ReviewPages").then((m) => ({ default: m.ReviewQueuePage })));
const LoginPage = lazy(() => import("./pages/auth/AuthPages").then((m) => ({ default: m.LoginPage })));
const SignupPage = lazy(() => import("./pages/auth/AuthPages").then((m) => ({ default: m.SignupPage })));
const MapPage = lazy(() => import("./pages/MapPage").then((m) => ({ default: m.MapPage })));
const ExplorePage = lazy(() => import("./features/explore/ExplorePage"));
const SermonsDashboard = lazy(() => import("./features/sermons/SermonsDashboard"));
const SermonWorkspace = lazy(() => import("./features/sermons/SermonWorkspace"));
const SharePage = lazy(() => import("./features/sermons/SharePage"));

const TITLES: [RegExp, string][] = [
  [/^\/$/, "Home"],
  [/^\/explore/, "Explore"],
  [/^\/sermons/, "Sermon Studio"],
  [/^\/search/, "Search & Ask"],
  [/^\/library/, "Library"],
  [/^\/verse\//, "Verse insights"],
  [/^\/clip\//, "Clip"],
  [/^\/map/, "Scripture Map"],
  [/^\/admin/, "Admin"],
  [/^\/login/, "Sign in"],
  [/^\/signup/, "Create account"],
];

/** Sign-in pages only exist in accounts mode; in personal mode you are already the owner. */
function AccountsOnly({ children }: { children: ReactNode }) {
  const { singleUser, loading } = useAuth();
  const location = useLocation();
  if (loading) return <PageLoader />;
  if (singleUser) {
    const from = (location.state as { from?: string } | null)?.from;
    return <Navigate to={from && from.startsWith("/") && !from.startsWith("/login") && !from.startsWith("/signup") ? from : "/"} replace />;
  }
  return <>{children}</>;
}

function PageLoader() {
  return (
    <div className="grid grid-cols-1 min-h-[50vh] place-items-center text-ink-3" role="status">
      <span className="inline-flex items-center gap-2.5 text-sm font-medium">
        <Loader2 className="size-5 animate-spin text-gold-600 dark:text-gold-400" aria-hidden /> Loading…
      </span>
    </div>
  );
}

function NotFound() {
  return (
    <div className="mx-auto grid grid-cols-1 min-h-[70vh] w-full max-w-xl place-items-center px-6 py-16 text-center">
      <div className="flex animate-fade-up flex-col items-center">
        <span className="grid grid-cols-1 size-16 place-items-center rounded-2xl bg-gold-50 text-gold-700 ring-1 ring-gold-500/20 dark:bg-gold-400/10 dark:text-gold-300 dark:ring-gold-400/20">
          <Compass className="size-7" aria-hidden />
        </span>
        <p className="mt-6 text-xs font-semibold tracking-[0.14em] text-gold-700 uppercase dark:text-gold-300">Page not found</p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-balance text-ink sm:text-4xl">This path doesn't lead anywhere</h1>
        <p className="mt-3 max-w-md text-[15px]/relaxed text-ink-2">The link may be old, or the page was moved. Here are a few good places to go instead.</p>
        <div className="mt-7 flex flex-wrap justify-center gap-2">
          <Link to="/" className={buttonClass("primary")}><HomeIcon aria-hidden /> Go home</Link>
          <Link to="/read" className={buttonClass("secondary")}><BookOpen aria-hidden /> Open the Bible</Link>
          <button type="button" onClick={() => openCommandPalette()} className={buttonClass("secondary")}><Search aria-hidden /> Search</button>
        </div>
      </div>
    </div>
  );
}

function useDocumentTitle() {
  const { pathname } = useLocation();
  useEffect(() => {
    if (pathname.startsWith("/read") || pathname.startsWith("/resources/")) return; // these pages set their own titles (chapter / resource name)
    const match = TITLES.find(([re]) => re.test(pathname));
    document.title = match ? `${match[1]} · Interactive Bible App` : "Interactive Bible App";
  }, [pathname]);
}

export default function App() {
  const location = useLocation();
  const background = (location.state as { background?: Location } | null)?.background;
  useDocumentTitle();

  if (location.pathname.startsWith("/share/")) {
    return (
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/share/:slug" element={<SharePage />} />
        </Routes>
      </Suspense>
    );
  }

  return (
    <AppShell>
      <Suspense fallback={<PageLoader />}>
        <Routes location={background || location}>
          <Route path="/" element={<HomePage />} />
          <Route path="/read" element={<ReadRedirect />} />
          <Route path="/read/:book/:chapter" element={<ReadPage />} />
          <Route path="/verse/:ref" element={<VersePage />} />
          <Route path="/clip/:segmentId" element={<ClipPage />} />
          <Route path="/resources/:id" element={<ResourcePage />} />
          <Route path="/explore" element={<ExplorePage />} />
          <Route path="/sermons" element={<SermonsDashboard />} />
          <Route path="/sermons/:id" element={<SermonWorkspace />} />
          <Route path="/map" element={<MapPage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/library" element={<LibraryPage />} />
          <Route path="/login" element={<AccountsOnly><LoginPage /></AccountsOnly>} />
          <Route path="/signup" element={<AccountsOnly><SignupPage /></AccountsOnly>} />
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<AdminDashboard />} />
            <Route path="review" element={<ReviewQueuePage />} />
            <Route path="review/:id" element={<MappingReviewPage />} />
            <Route path="ingest" element={<IngestPage />} />
            <Route path="resources" element={<ResourcesMonitorPage />} />
            <Route path="resources/:id" element={<ResourceAdminPage />} />
            <Route path="feedback" element={<FeedbackAdminPage />} />
            <Route path="audit" element={<AuditPage />} />
            <Route path="metrics" element={<MetricsPage />} />
            <Route path="vocabulary" element={<VocabularyPage />} />
            <Route path="system" element={<SystemPage />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
        {background && (
          <Routes>
            <Route path="/clip/:segmentId" element={<ClipModal />} />
          </Routes>
        )}
      </Suspense>
    </AppShell>
  );
}
