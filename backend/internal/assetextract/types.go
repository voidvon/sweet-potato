package assetextract

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
)

var ErrUnsupportedFormat = errors.New("unsupported asset format")

type Input struct {
	FileName string
	MimeType string
	FilePath string
	Bytes    []byte
}

type Descriptor struct {
	Name    string   `json:"name"`
	Version string   `json:"version"`
	Kinds   []string `json:"kinds"`
}

type Locator struct {
	Kind  string `json:"kind"`
	Index int    `json:"index"`
}

type ContentUnit struct {
	Locator     Locator        `json:"locator"`
	Text        string         `json:"text,omitempty"`
	ArtifactIDs []string       `json:"artifactIds,omitempty"`
	Metadata    map[string]any `json:"metadata,omitempty"`
}

type Artifact struct {
	ID       string         `json:"id"`
	Kind     string         `json:"kind"`
	FileName string         `json:"fileName"`
	MimeType string         `json:"mimeType"`
	Data     []byte         `json:"-"`
	Locator  *Locator       `json:"locator,omitempty"`
	Metadata map[string]any `json:"metadata,omitempty"`
}

type Result struct {
	FileName  string         `json:"fileName"`
	Kind      string         `json:"kind"`
	Parser    string         `json:"parser"`
	Version   string         `json:"version"`
	Text      string         `json:"text,omitempty"`
	Units     []ContentUnit  `json:"units,omitempty"`
	Artifacts []Artifact     `json:"artifacts,omitempty"`
	Metadata  map[string]any `json:"metadata,omitempty"`
	Warnings  []string       `json:"warnings,omitempty"`
}

type Parser interface {
	Descriptor() Descriptor
	Supports(Input) bool
	Parse(context.Context, Input) (Result, error)
}

type Service struct {
	parsers []Parser
}

func NewService(parsers ...Parser) *Service {
	registered := make([]Parser, 0, len(parsers))
	for _, parser := range parsers {
		if parser != nil {
			registered = append(registered, parser)
		}
	}
	return &Service{parsers: registered}
}

func NewDefaultService() *Service {
	return NewService(NewPPTXParser(), NewPDFParser())
}

func (s *Service) Parse(ctx context.Context, input Input) (Result, error) {
	if s == nil {
		return Result{}, errors.New("asset extraction service is not configured")
	}
	input.FileName = strings.TrimSpace(input.FileName)
	input.MimeType = normalizedMimeType(input.MimeType)
	input.FilePath = strings.TrimSpace(input.FilePath)
	if input.FileName == "" && input.FilePath != "" {
		input.FileName = filepath.Base(input.FilePath)
	}
	for _, parser := range s.parsers {
		if !parser.Supports(input) {
			continue
		}
		result, err := parser.Parse(ctx, input)
		if err != nil {
			return Result{}, fmt.Errorf("%s: %w", parser.Descriptor().Name, err)
		}
		return result, nil
	}
	return Result{}, fmt.Errorf("%w: %s", ErrUnsupportedFormat, input.FileName)
}

func (s *Service) DescriptorFor(input Input) (Descriptor, error) {
	if s == nil {
		return Descriptor{}, errors.New("asset extraction service is not configured")
	}
	input.FileName = strings.TrimSpace(input.FileName)
	input.MimeType = normalizedMimeType(input.MimeType)
	input.FilePath = strings.TrimSpace(input.FilePath)
	if input.FileName == "" && input.FilePath != "" {
		input.FileName = filepath.Base(input.FilePath)
	}
	for _, parser := range s.parsers {
		if parser.Supports(input) {
			return parser.Descriptor(), nil
		}
	}
	return Descriptor{}, fmt.Errorf("%w: %s", ErrUnsupportedFormat, input.FileName)
}

func (s *Service) Descriptors() []Descriptor {
	if s == nil {
		return nil
	}
	result := make([]Descriptor, 0, len(s.parsers))
	for _, parser := range s.parsers {
		result = append(result, parser.Descriptor())
	}
	return result
}

func normalizedMimeType(value string) string {
	return strings.ToLower(strings.TrimSpace(strings.SplitN(value, ";", 2)[0]))
}
