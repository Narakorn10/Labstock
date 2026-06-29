import MobileStockWorkflow from '@/components/mobile-stock-workflow';

type MobileDispensePageProps = {
  searchParams?: Promise<{
    code?: string;
    lot?: string;
  }>;
};

export default async function MobileDispensePage({ searchParams }: MobileDispensePageProps) {
  const params = (await searchParams) || {};

  return (
    <MobileStockWorkflow
      mode="dispense"
      deepLinkCode={params.code?.trim() || ""}
      deepLinkLot={params.lot?.trim() || ""}
    />
  );
}
