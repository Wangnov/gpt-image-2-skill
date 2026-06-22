import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  JobStatus,
  NotificationConfig,
  PathConfig,
  ProviderConfig,
  ProxyConfig,
  ServerConfig,
  StorageConfig,
  StorageTargetConfig,
} from "@/lib/types";

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
    mutationFn: (config: StorageConfig) => {
      if (!api.updateStorage) {
        throw new Error("当前运行环境不支持修改存储配置。");
      }
      return api.updateStorage(config);
    },
    onSuccess: (data) => qc.setQueryData(["config"], data),
  });
}

export function useUpdateProxy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (config: ProxyConfig) => api.updateProxy(config),
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
    }) => {
      if (!api.testStorageTarget) {
        throw new Error("当前运行环境不支持测试存储目标。");
      }
      return api.testStorageTarget(name, target);
    },
  });
}
