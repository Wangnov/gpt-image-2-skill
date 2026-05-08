import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { browserApi } from "@/lib/api/browser-transport";
import { httpApi } from "@/lib/api/http-transport";
import { tauriApi } from "@/lib/api/tauri-transport";
import type {
  JobStatus,
  NotificationConfig,
  PathConfig,
  ProviderConfig,
  ServerConfig,
  StorageConfig,
  StorageTargetConfig,
} from "@/lib/types";

function storageApi() {
  if (api.kind === "tauri") {
    return tauriApi as typeof tauriApi & Required<Pick<typeof tauriApi, "updateStorage" | "testStorageTarget">>;
  }
  if (api.kind === "http") {
    return httpApi as typeof httpApi & Required<Pick<typeof httpApi, "updateStorage" | "testStorageTarget">>;
  }
  return browserApi as typeof browserApi &
    Required<Pick<typeof browserApi, "updateStorage" | "testStorageTarget">>;
}

export function useConfig() {
  return useQuery<ServerConfig>({
    queryKey: ["config"],
    queryFn: api.getConfig,
  });
}

export function useSetDefaultProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.setDefault(name),
    onSuccess: (data) => qc.setQueryData(["config"], data),
  });
}

export function useUpsertProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, cfg }: { name: string; cfg: ProviderConfig }) =>
      api.upsertProvider(name, cfg),
    onSuccess: (data) => qc.setQueryData(["config"], data),
  });
}

export function useDeleteProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.deleteProvider(name),
    onSuccess: (data) => qc.setQueryData(["config"], data),
  });
}

export function useTestProvider() {
  return useMutation({ mutationFn: (name: string) => api.testProvider(name) });
}

export function useUpdateNotifications() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (config: NotificationConfig) => api.updateNotifications(config),
    onSuccess: (data) => qc.setQueryData(["config"], data),
  });
}

export function useNotificationCapabilities() {
  return useQuery({
    queryKey: ["notification-capabilities"],
    queryFn: api.notificationCapabilities,
    staleTime: 60_000,
  });
}

export function useTestNotifications() {
  return useMutation({
    mutationFn: (status?: JobStatus) => api.testNotifications(status),
  });
}

export function useUpdatePaths() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (config: PathConfig) => {
      if (!api.updatePaths) {
        throw new Error("当前运行环境不支持修改本机路径。");
      }
      return api.updatePaths(config);
    },
    onSuccess: (data) => {
      qc.setQueryData(["config"], data);
      void qc.invalidateQueries({ queryKey: ["config-paths"] });
    },
  });
}

export function useUpdateStorage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (config: StorageConfig) => storageApi().updateStorage(config),
    onSuccess: (data) => qc.setQueryData(["config"], data),
  });
}

export function useTestStorageTarget() {
  return useMutation({
    mutationFn: ({
      name,
      target,
    }: {
      name: string;
      target?: StorageTargetConfig;
    }) => storageApi().testStorageTarget(name, target),
  });
}
