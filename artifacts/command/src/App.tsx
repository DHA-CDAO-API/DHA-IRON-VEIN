import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useEffect } from "react";
import NotFound from "@/pages/not-found";
import Layout from "@/components/layout/Layout";

// Pages
import CommandOverview from "@/pages/CommandOverview";
import NetworkMap from "@/pages/NetworkMap";
import SiteDetail from "@/pages/SiteDetail";
import ItemDetail from "@/pages/ItemDetail";
import OrdersBoard from "@/pages/OrdersBoard";
import PurchaseOrder from "@/pages/PurchaseOrder";
import Scenarios from "@/pages/Scenarios";
import Copilot from "@/pages/Copilot";
import DataAdmin from "@/pages/DataAdmin";
import Settings from "@/pages/Settings";
import Profile from "@/pages/Profile";

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      {/* Print route has no layout */}
      <Route path="/orders/:id/print" component={PurchaseOrder} />

      <Route>
        <Layout>
          <Switch>
            <Route path="/" component={CommandOverview} />
            <Route path="/network" component={NetworkMap} />
            <Route path="/sites/:nodeId" component={SiteDetail} />
            <Route path="/items/:itemId" component={ItemDetail} />
            <Route path="/orders" component={OrdersBoard} />
            <Route path="/scenarios" component={Scenarios} />
            <Route path="/copilot" component={Copilot} />
            <Route path="/data" component={DataAdmin} />
            <Route path="/settings" component={Settings} />
            <Route path="/profile" component={Profile} />
            <Route component={NotFound} />
          </Switch>
        </Layout>
      </Route>
    </Switch>
  );
}

function App() {
  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
