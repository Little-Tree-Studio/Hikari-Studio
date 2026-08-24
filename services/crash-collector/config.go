package main

import (
	"fmt"
	"os"
)

type settings struct {
	databaseURL string
	s3Endpoint  string
	s3AccessKey string
	s3SecretKey string
	s3Bucket    string
	s3SSE       string
	adminToken  string
	ipHashSalt  string
}

func settingsFromEnv() (settings, error) {
	required := func(name string) (string, error) {
		value, ok := os.LookupEnv(name)
		if !ok || value == "" {
			return "", fmt.Errorf("required environment variable %s is not set", name)
		}
		return value, nil
	}

	var result settings
	var err error
	if result.databaseURL, err = required("DATABASE_URL"); err != nil {
		return settings{}, err
	}
	if result.s3Endpoint, err = required("S3_ENDPOINT"); err != nil {
		return settings{}, err
	}
	if result.s3AccessKey, err = required("S3_ACCESS_KEY"); err != nil {
		return settings{}, err
	}
	if result.s3SecretKey, err = required("S3_SECRET_KEY"); err != nil {
		return settings{}, err
	}
	if result.adminToken, err = required("ADMIN_TOKEN"); err != nil {
		return settings{}, err
	}
	if result.ipHashSalt, err = required("IP_HASH_SALT"); err != nil {
		return settings{}, err
	}
	result.s3Bucket = os.Getenv("S3_BUCKET")
	if result.s3Bucket == "" {
		result.s3Bucket = "slide-crash-reports"
	}
	result.s3SSE = os.Getenv("S3_SERVER_SIDE_ENCRYPTION")
	if result.s3SSE == "" {
		result.s3SSE = "AES256"
	}
	if result.s3SSE != "AES256" && result.s3SSE != "none" {
		return settings{}, fmt.Errorf("S3_SERVER_SIDE_ENCRYPTION must be AES256 or none")
	}
	return result, nil
}
