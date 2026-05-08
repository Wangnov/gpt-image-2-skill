import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { api } from "@/lib/api";
import { isActiveJobStatus, type JobListFilter } from "@/lib/api/types";
import type { GenerateRequest, Job, QueueStatus } from "@/lib/types";

export function useJobs() {
  return useQuery<Job[]>({
    queryKey: ["jobs"],
    queryFn: api.listJobs,
    refetchInterval: (query) => {
      const jobs = query.state.data as Job[] | undefined;
      return jobs?.some((job) => isActiveJobStatus(job.status))
        ? 1_500
        : 8_000;
    },
  });
}

export function useActiveJobs() {
  return useQuery<Job[]>({
    queryKey: ["jobs", "active"],
    queryFn: api.listActiveJobs,
    refetchInterval: (query) => {
      const jobs = query.state.data as Job[] | undefined;
      return jobs?.length ? 1_500 : 8_000;
    },
  });
}

export function useJobPages(filter: JobListFilter = "all", query = "") {
  return useInfiniteQuery({
    queryKey: ["jobs", "pages", filter, query],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api.listJobsPage({
        limit: 100,
        cursor: pageParam,
        filter,
        query,
      }),
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    enabled: filter !== "running",
    refetchInterval: filter === "all" ? 4_000 : false,
  });
}

export function useJob(id?: string) {
  return useQuery({
    queryKey: ["job", id],
    queryFn: () => api.getJob(id!),
    enabled: !!id,
  });
}

export function useCreateGenerate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: GenerateRequest) => api.createGenerate(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["jobs"] }),
  });
}

export function useCreateEdit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (form: FormData) => api.createEdit(form),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["jobs"] }),
  });
}

export function useDeleteJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteJob(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["jobs"] }),
  });
}

export function useCancelJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.cancelJob(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["jobs"] }),
  });
}

export function useRetryJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.retryJob(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["jobs"] }),
  });
}

export function useQueueStatus() {
  return useQuery<QueueStatus>({
    queryKey: ["queue-status"],
    queryFn: api.queueStatus,
    refetchInterval: 3_000,
  });
}
