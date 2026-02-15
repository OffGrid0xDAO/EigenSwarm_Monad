import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { WalletProvider } from './lib/wallet';
import { Layout } from './components/Layout';
import { LaunchAndDistribute } from './pages/LaunchAndDistribute';
import { BundleSell } from './pages/BundleSell';

function App() {
  return (
    <WalletProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<LaunchAndDistribute />} />
            <Route path="bundle-sell" element={<BundleSell />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </WalletProvider>
  );
}

export default App;
