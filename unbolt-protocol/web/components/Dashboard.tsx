'use client';

import { useWallet } from "@solana/wallet-adapter-react";
import { useEffect, useState } from "react";
import { useUnboltProtocol } from "@/hooks/useUnboltProtocol";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@radix-ui/react-tabs";
import { Loader2, AlertCircle, CheckCircle } from "lucide-react";

export function Dashboard() {
  const { connected, publicKey } = useWallet();
  const { fetchUserDebtAccount, initializeUserDebtAccount, loading } = useUnboltProtocol();
  const [debtAccount, setDebtAccount] = useState<any>(null);
  const [hasAccount, setHasAccount] = useState(false);

  useEffect(() => {
    if (connected && publicKey) {
      loadDebtAccount();
    }
  }, [connected, publicKey]);

  const loadDebtAccount = async () => {
    const account = await fetchUserDebtAccount();
    if (account) {
      setDebtAccount(account);
      setHasAccount(true);
    }
  };

  const handleInitialize = async () => {
    try {
      await initializeUserDebtAccount();
      await loadDebtAccount();
    } catch (error) {
      console.error("Failed to initialize:", error);
    }
  };

  if (!connected) {
    return (
      <Card className="max-w-md mx-auto mt-20">
        <CardHeader>
          <CardTitle>Connect Wallet</CardTitle>
          <CardDescription>
            Please connect your Solana wallet to use Unbolt Protocol
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (!hasAccount) {
    return (
      <Card className="max-w-md mx-auto mt-20">
        <CardHeader>
          <CardTitle>Initialize Account</CardTitle>
          <CardDescription>
            You need to initialize your debt account first
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={handleInitialize} disabled={loading} className="w-full">
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Initialize Account
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="container mx-auto p-6">
      <h1 className="text-3xl font-bold mb-6">Unbolt Dashboard</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
        <Card>
          <CardHeader>
            <CardTitle>Borrowed Amount</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              ${(debtAccount?.borrowedAmount / 1_000_000).toLocaleString()}
            </p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader>
            <CardTitle>Repaid Amount</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-green-600">
              ${(debtAccount?.totalRepaid / 1_000_000).toLocaleString()}
            </p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader>
            <CardTitle>Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center">
              {debtAccount?.isActive ? (
                <>
                  <CheckCircle className="text-green-500 mr-2" />
                  <span>Active</span>
                </>
              ) : (
                <>
                  <AlertCircle className="text-yellow-500 mr-2" />
                  <span>No Active Loan</span>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="borrow" className="w-full">
        <TabsList className="flex space-x-4 mb-4">
          <TabsTrigger value="borrow">Borrow</TabsTrigger>
          <TabsTrigger value="repay">Repay</TabsTrigger>
          <TabsTrigger value="info">Loan Info</TabsTrigger>
        </TabsList>
        
        <TabsContent value="borrow">
          <BorrowForm />
        </TabsContent>
        
        <TabsContent value="repay">
          <RepayForm />
        </TabsContent>
        
        <TabsContent value="info">
          <LoanInfo debtAccount={debtAccount} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function BorrowForm() {
  const { initiateLoan, loading } = useUnboltProtocol();
  const [amount, setAmount] = useState("");
  const [duration, setDuration] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const borrowAmount = parseFloat(amount) * 1_000_000; // Convert to USDC decimals
      const durationSeconds = parseInt(duration) * 3600;
      await initiateLoan(borrowAmount, durationSeconds);
      alert("Loan initiated successfully!");
    } catch (error) {
      console.error("Failed to initiate loan:", error);
      alert("Failed to initiate loan");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Borrow USDC</CardTitle>
        <CardDescription>
          Get instant liquidity with continuous repayment streaming
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Amount (USDC)</label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full p-2 border rounded-md"
              placeholder="1000"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Duration (hours)</label>
            <input
              type="number"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              className="w-full p-2 border rounded-md"
              placeholder="24"
              required
            />
          </div>
          <Button type="submit" disabled={loading} className="w-full">
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Borrow USDC
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function RepayForm() {
  const { processRepayment, loading } = useUnboltProtocol();

  const handleRepay = async () => {
    try {
      await processRepayment();
      alert("Repayment processed successfully!");
    } catch (error) {
      console.error("Failed to process repayment:", error);
      alert("Failed to process repayment");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Process Repayment</CardTitle>
        <CardDescription>
          Trigger streaming repayment from your wallet
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button onClick={handleRepay} disabled={loading} className="w-full">
          {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Process Repayment
        </Button>
      </CardContent>
    </Card>
  );
}

function LoanInfo({ debtAccount }: { debtAccount: any }) {
  if (!debtAccount || !debtAccount.isActive) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-center text-gray-500">No active loan found</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Active Loan Details</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p><strong>Stream Rate:</strong> {(debtAccount.streamRate / 1_000_000).toFixed(6)} USDC/sec</p>
        <p><strong>Last Update:</strong> {new Date(debtAccount.lastUpdateTimestamp * 1000).toLocaleString()}</p>
        <p><strong>Repayment End:</strong> {new Date(debtAccount.repaymentEndTime * 1000).toLocaleString()}</p>
        <p><strong>Remaining:</strong> ${((debtAccount.borrowedAmount - debtAccount.totalRepaid) / 1_000_000).toLocaleString()}</p>
      </CardContent>
    </Card>
  );
}