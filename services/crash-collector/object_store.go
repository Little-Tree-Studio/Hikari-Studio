package main

import (
	"bytes"
	"context"
	"fmt"
	"net/url"
	"strings"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
	"github.com/minio/minio-go/v7/pkg/encrypt"
)

type objectStore interface {
	Health(context.Context) error
	Put(context.Context, string, []byte) error
	DeleteMany(context.Context, []string) error
}

type s3ObjectStore struct {
	client               *minio.Client
	bucket               string
	serverSideEncryption encrypt.ServerSide
}

func newS3ObjectStore(settings settings) (*s3ObjectStore, error) {
	endpoint, err := url.Parse(settings.s3Endpoint)
	if err != nil || endpoint.Host == "" || (endpoint.Scheme != "http" && endpoint.Scheme != "https") {
		return nil, fmt.Errorf("invalid S3_ENDPOINT %q", settings.s3Endpoint)
	}
	if strings.Trim(endpoint.Path, "/") != "" || endpoint.RawQuery != "" || endpoint.Fragment != "" {
		return nil, fmt.Errorf("S3_ENDPOINT must not contain a path, query, or fragment")
	}

	client, err := minio.New(endpoint.Host, &minio.Options{
		Creds:  credentials.NewStaticV4(settings.s3AccessKey, settings.s3SecretKey, ""),
		Secure: endpoint.Scheme == "https",
		Region: "us-east-1",
	})
	if err != nil {
		return nil, fmt.Errorf("create S3 client: %w", err)
	}
	store := &s3ObjectStore{client: client, bucket: settings.s3Bucket}
	if settings.s3SSE == "AES256" {
		store.serverSideEncryption = encrypt.NewSSE()
	}
	return store, nil
}

func (s *s3ObjectStore) Initialize(ctx context.Context) error {
	exists, existsErr := s.client.BucketExists(ctx, s.bucket)
	if existsErr == nil && exists {
		return nil
	}
	if err := s.client.MakeBucket(ctx, s.bucket, minio.MakeBucketOptions{Region: "us-east-1"}); err != nil {
		if existsErr != nil {
			return fmt.Errorf("check S3 bucket: %v; create S3 bucket: %w", existsErr, err)
		}
		return fmt.Errorf("create S3 bucket: %w", err)
	}
	return nil
}

func (s *s3ObjectStore) Health(ctx context.Context) error {
	exists, err := s.client.BucketExists(ctx, s.bucket)
	if err != nil {
		return fmt.Errorf("check S3 bucket: %w", err)
	}
	if !exists {
		return fmt.Errorf("S3 bucket %q does not exist", s.bucket)
	}
	return nil
}

func (s *s3ObjectStore) Put(ctx context.Context, key string, body []byte) error {
	_, err := s.client.PutObject(ctx, s.bucket, key, bytes.NewReader(body), int64(len(body)), minio.PutObjectOptions{
		ContentType:          "application/json",
		ServerSideEncryption: s.serverSideEncryption,
	})
	if err != nil {
		return fmt.Errorf("store crash report object: %w", err)
	}
	return nil
}

func (s *s3ObjectStore) DeleteMany(ctx context.Context, keys []string) error {
	objects := make([]minio.ObjectInfo, 0, len(keys))
	for _, key := range keys {
		objects = append(objects, minio.ObjectInfo{Key: key})
	}
	for result := range s.client.RemoveObjects(ctx, s.bucket, objectsChannel(objects), minio.RemoveObjectsOptions{}) {
		if result.Err != nil {
			return fmt.Errorf("delete crash report objects: %w", result.Err)
		}
	}
	return nil
}

func objectsChannel(objects []minio.ObjectInfo) <-chan minio.ObjectInfo {
	channel := make(chan minio.ObjectInfo)
	go func() {
		defer close(channel)
		for _, object := range objects {
			channel <- object
		}
	}()
	return channel
}
